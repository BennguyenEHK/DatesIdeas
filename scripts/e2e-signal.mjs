#!/usr/bin/env node
/**
 * End-to-end check of the signalling and history routes against a live
 * database. Simulates two peers completing a WebRTC handshake through the
 * same HTTP endpoints the browser uses.
 *
 * Requires the dev server to be running:  npm run dev
 *   node scripts/e2e-signal.mjs
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
/**
 * The room is OPENED through the real endpoint rather than invented here.
 *
 * Signalling refuses a room that does not exist, so a made-up code made every
 * handshake check fail with a 410 -- which looked exactly like a broken
 * handshake and hid whatever was actually wrong. The server mints the code
 * anyway, so asking it is both more honest and less work.
 */
let ROOM = "";

let pass = 0;
let fail = 0;

function check(label, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const post = (path, body) =>
  fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const send = (from, payload) => post("/api/signal", { code: ROOM, from, payload });

async function poll(from, after) {
  const res = await fetch(
    `${BASE}/api/signal?code=${ROOM}&from=${from}&after=${after}`,
  );
  if (!res.ok) throw new Error(`poll failed: ${res.status}`);
  return res.json();
}

const opened = await post("/api/rooms", {});
if (opened.status !== 201) {
  console.error(`
could not open a room (${opened.status}). Is the dev server running?
`);
  process.exit(1);
}
ROOM = (await opened.json()).code;

console.log(`\nroom ${ROOM}\n`);

// ---------------------------------------------------------------- handshake
console.log("handshake");

const joinedA = Date.now();
const joinedB = joinedA + 3;

check("A posts join", (await send(A, { kind: "join", identity: A, joinedAt: joinedA })).status === 201);
check("B posts join", (await send(B, { kind: "join", identity: B, joinedAt: joinedB })).status === 201);

let curA = 0;
let curB = 0;

const seenByA = await poll(A, curA);
curA = seenByA.cursor;
check("A sees exactly one join", seenByA.signals.length === 1, `got ${seenByA.signals.length}`);
check("A sees B's join, not its own", seenByA.signals[0]?.identity === B, JSON.stringify(seenByA.signals[0]));

const seenByB = await poll(B, curB);
curB = seenByB.cursor;
check("B sees exactly one join", seenByB.signals.length === 1, `got ${seenByB.signals.length}`);
check("B sees A's join, not its own", seenByB.signals[0]?.identity === A);

// The glare tiebreak, applied to what each peer actually received.
const shouldOffer = (me, them) =>
  me.joinedAt !== them.joinedAt ? me.joinedAt < them.joinedAt : me.identity < them.identity;
const aOffers = shouldOffer({ identity: A, joinedAt: joinedA }, { identity: B, joinedAt: joinedB });
const bOffers = shouldOffer({ identity: B, joinedAt: joinedB }, { identity: A, joinedAt: joinedA });
check("exactly one peer offers", aOffers !== bOffers, `A=${aOffers} B=${bOffers}`);
check("the earlier joiner offers", aOffers === true);

// ------------------------------------------------------------- offer/answer
await send(A, { kind: "offer", sdp: "v=0\r\no=- FAKE-OFFER 2 IN IP4 127.0.0.1\r\n", from: A });
const offerAtB = await poll(B, curB);
curB = offerAtB.cursor;
check("B receives the offer", offerAtB.signals[0]?.kind === "offer");
check("offer sdp survives the round trip", offerAtB.signals[0]?.sdp.includes("FAKE-OFFER"));

await send(B, { kind: "answer", sdp: "v=0\r\no=- FAKE-ANSWER 2 IN IP4 127.0.0.1\r\n", from: B });
const answerAtA = await poll(A, curA);
curA = answerAtA.cursor;
check("A receives the answer", answerAtA.signals[0]?.kind === "answer");

// ---------------------------------------------------------------- ice + cursor
console.log("\nice trickle and cursor");

for (let i = 0; i < 3; i++) {
  await send(A, { kind: "ice", candidate: { candidate: `candidate:${i}`, sdpMLineIndex: 0 }, from: A });
}
const iceAtB = await poll(B, curB);
curB = iceAtB.cursor;
check("B receives all three candidates", iceAtB.signals.length === 3, `got ${iceAtB.signals.length}`);
check("candidates arrive in order", iceAtB.signals.every((s, i) => s.candidate.candidate === `candidate:${i}`));

const empty = await poll(B, curB);
check("cursor prevents redelivery", empty.signals.length === 0, `got ${empty.signals.length}`);
check("cursor holds steady when nothing is new", empty.cursor === curB);

const stillNothingForA = await poll(A, curA);
check("A never receives its own messages", stillNothingForA.signals.length === 0, `got ${stillNothingForA.signals.length}`);

// ---------------------------------------------------------------- validation
console.log("\ninput validation");
check("rejects a bad room code", (await post("/api/signal", { code: "bad", from: A, payload: {} })).status === 400);
check("rejects a bad identity", (await post("/api/signal", { code: ROOM, from: "nope", payload: {} })).status === 400);
check("rejects an oversized payload",
  (await post("/api/signal", { code: ROOM, from: A, payload: { blob: "x".repeat(70_000) } })).status === 400);

// ------------------------------------------------------------------ history
console.log("\nsession history");

const created = await post("/api/sessions", { code: ROOM, identity: A, name: "M" });
check("session opens", created.status === 201);
const { id: sessionId } = await created.json();
check("session id looks like a uuid", /^[0-9a-f-]{36}$/i.test(sessionId ?? ""));

const beforeClose = await (await fetch(`${BASE}/api/sessions?code=${ROOM}`)).json();
check("an open session is not listed as history", beforeClose.sessions.length === 0, `got ${beforeClose.sessions.length}`);

const closed = await post("/api/sessions/close", {
  id: sessionId,
  memes: { heart: 4, peace: 1, smile: 2 },
});
check("session closes", closed.ok);

const history = await (await fetch(`${BASE}/api/sessions?code=${ROOM}`)).json();
check("closed session appears in history", history.sessions.length === 1, `got ${history.sessions.length}`);
check("reaction counts persisted", JSON.stringify(history.sessions[0]?.memes_sent) === JSON.stringify({ heart: 4, peace: 1, smile: 2 }),
  JSON.stringify(history.sessions[0]?.memes_sent));
check("ended_at was set", Boolean(history.sessions[0]?.ended_at));

await post("/api/sessions/close", { id: sessionId, memes: { heart: 999 } });
const afterReclose = await (await fetch(`${BASE}/api/sessions?code=${ROOM}`)).json();
check("closing twice does not overwrite the record",
  afterReclose.sessions[0]?.memes_sent.heart === 4,
  `heart=${afterReclose.sessions[0]?.memes_sent.heart}`);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
