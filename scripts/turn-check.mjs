#!/usr/bin/env node
/**
 * Proves the TURN relay actually works, not merely that /api/turn returns
 * credentials.
 *
 * Performs a real RFC 5766 Allocate handshake over UDP: an unauthenticated
 * Allocate draws a 401 carrying REALM and NONCE, then a second Allocate signed
 * with MESSAGE-INTEGRITY should come back 200 with a relayed address. Getting
 * that address is the same thing a browser needs before it can route a call
 * through the relay, which is what rescues peers behind symmetric NAT.
 *
 *   npm run dev            # in another shell
 *   node scripts/turn-check.mjs
 */
import dgram from "node:dgram";
import crypto from "node:crypto";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const MAGIC = 0x2112a442;

const ATTR = {
  USERNAME: 0x0006,
  MESSAGE_INTEGRITY: 0x0008,
  ERROR_CODE: 0x0009,
  REALM: 0x0014,
  NONCE: 0x0015,
  XOR_RELAYED_ADDRESS: 0x0016,
  REQUESTED_TRANSPORT: 0x0019,
};

const pad4 = (n) => (n + 3) & ~3;

function attr(type, value) {
  const buf = Buffer.alloc(4 + pad4(value.length));
  buf.writeUInt16BE(type, 0);
  buf.writeUInt16BE(value.length, 2);
  value.copy(buf, 4);
  return buf;
}

function message(type, txId, attrs, integrityKey) {
  let body = Buffer.concat(attrs);
  const header = Buffer.alloc(20);
  header.writeUInt16BE(type, 0);
  header.writeUInt32BE(MAGIC, 4);
  txId.copy(header, 8);

  if (integrityKey) {
    // The length used for the HMAC must already account for the attribute
    // that is about to be appended (4 header bytes + 20 bytes of SHA-1).
    header.writeUInt16BE(body.length + 24, 2);
    const hmac = crypto
      .createHmac("sha1", integrityKey)
      .update(Buffer.concat([header, body]))
      .digest();
    body = Buffer.concat([body, attr(ATTR.MESSAGE_INTEGRITY, hmac)]);
  }
  header.writeUInt16BE(body.length, 2);
  return Buffer.concat([header, body]);
}

function parse(buf) {
  const out = { type: buf.readUInt16BE(0), attrs: {} };
  let off = 20;
  const end = 20 + buf.readUInt16BE(2);
  while (off + 4 <= end) {
    const type = buf.readUInt16BE(off);
    const len = buf.readUInt16BE(off + 2);
    out.attrs[type] = buf.subarray(off + 4, off + 4 + len);
    off += 4 + pad4(len);
  }
  return out;
}

function xorAddress(buf) {
  const port = buf.readUInt16BE(2) ^ (MAGIC >>> 16);
  const ip = [];
  for (let i = 0; i < 4; i++) {
    ip.push(buf[4 + i] ^ ((MAGIC >>> (24 - 8 * i)) & 0xff));
  }
  return `${ip.join(".")}:${port}`;
}

function send(socket, host, port, msg, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeListener("message", onMessage);
      reject(new Error("timed out waiting for the TURN server"));
    }, timeoutMs);
    function onMessage(data) {
      clearTimeout(timer);
      socket.removeListener("message", onMessage);
      resolve(parse(data));
    }
    socket.on("message", onMessage);
    socket.send(msg, port, host, (err) => {
      if (err) {
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}

// ---------------------------------------------------------------------------

console.log("\nfetching credentials from /api/turn");
const res = await fetch(`${BASE}/api/turn`);
if (!res.ok) {
  console.error(`  /api/turn returned ${res.status} — TURN is not configured`);
  process.exit(1);
}
const body = await res.json();
const relay = body.iceServers.find((s) =>
  (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) => u.startsWith("turn")),
);
if (!relay?.username) {
  console.error("  no TURN entry with credentials in the response");
  process.exit(1);
}
console.log(`  got credentials, username ${relay.username.slice(0, 12)}...`);

const udp = (Array.isArray(relay.urls) ? relay.urls : [relay.urls]).find(
  (u) => u.startsWith("turn:") && u.includes("transport=udp"),
);
const host = udp.split(":")[1].split("?")[0];
const port = Number(udp.split(":")[2].split("?")[0]);
console.log(`  relay endpoint ${host}:${port}`);

const socket = dgram.createSocket("udp4");
const txId = crypto.randomBytes(12);
const requestedTransport = attr(
  ATTR.REQUESTED_TRANSPORT,
  Buffer.from([17, 0, 0, 0]), // 17 = UDP
);

try {
  console.log("\nstep 1: unauthenticated Allocate (expecting 401 with a nonce)");
  const challenge = await send(
    socket,
    host,
    port,
    message(0x0003, txId, [requestedTransport]),
  );

  const code = challenge.attrs[ATTR.ERROR_CODE];
  const errNum = code ? code[2] * 100 + code[3] : 0;
  if (errNum !== 401) {
    console.error(`  unexpected: got ${errNum || challenge.type}, wanted 401`);
    process.exit(1);
  }
  const realm = challenge.attrs[ATTR.REALM];
  const nonce = challenge.attrs[ATTR.NONCE];
  console.log(`  401 as expected, realm "${realm.toString()}"`);

  console.log("\nstep 2: signed Allocate (expecting a relayed address)");
  const key = crypto
    .createHash("md5")
    .update(`${relay.username}:${realm.toString()}:${relay.credential}`)
    .digest();

  const signed = await send(
    socket,
    host,
    port,
    message(
      0x0003,
      crypto.randomBytes(12),
      [
        requestedTransport,
        attr(ATTR.USERNAME, Buffer.from(relay.username)),
        attr(ATTR.REALM, realm),
        attr(ATTR.NONCE, nonce),
      ],
      key,
    ),
  );

  if (signed.type === 0x0113) {
    const c = signed.attrs[ATTR.ERROR_CODE];
    console.error(`  REJECTED: error ${c[2] * 100 + c[3]} ${c.subarray(4)}`);
    process.exit(1);
  }
  if (signed.type !== 0x0103) {
    console.error(`  unexpected message type 0x${signed.type.toString(16)}`);
    process.exit(1);
  }

  const relayed = signed.attrs[ATTR.XOR_RELAYED_ADDRESS];
  console.log(`  ALLOCATED — relayed address ${xorAddress(relayed)}`);
  console.log("\nTURN relay is working. Calls can fall back to it.\n");
} finally {
  socket.close();
}
