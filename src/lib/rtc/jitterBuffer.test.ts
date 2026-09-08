import { describe, expect, it } from "vitest";
import {
  applyJitterTarget,
  AUDIO_JITTER_TARGET_MS,
  DUETTING_JITTER_TARGET_FACTOR,
  jitterTargetMs,
  MAX_JITTER_TARGET_MS,
  TCP_RELAY_EXTRA_MS,
  VIDEO_JITTER_TARGET_MS,
} from "./jitterBuffer";
import type { BufferRoute, ReceiverLike } from "./jitterBuffer";

const direct = (netRttMs: number | null): BufferRoute => ({
  relayed: false,
  relayProtocol: null,
  netRttMs,
});

const relay = (relayProtocol: "udp" | "tcp"): BufferRoute => ({
  relayed: true,
  relayProtocol,
  netRttMs: 300,
});

describe("jitterTargetMs", () => {
  it("leaves the browser alone until a route has been measured", () => {
    expect(jitterTargetMs("audio", null, false)).toBeNull();
    expect(jitterTargetMs("video", null, true)).toBeNull();
  });

  it("keeps the zero-length request for fast direct routes", () => {
    expect(jitterTargetMs("audio", direct(null), false)).toBe(0);
    expect(jitterTargetMs("video", direct(150), false)).toBe(0);
  });

  it("uses stable positive targets for slow direct routes", () => {
    expect(jitterTargetMs("audio", direct(151), false)).toBe(
      AUDIO_JITTER_TARGET_MS,
    );
    expect(jitterTargetMs("video", direct(300), false)).toBe(
      VIDEO_JITTER_TARGET_MS,
    );
  });

  it("uses stable positive targets for UDP and TCP relays", () => {
    expect(jitterTargetMs("audio", relay("udp"), false)).toBe(
      AUDIO_JITTER_TARGET_MS,
    );
    // TCP is deliberately NOT the same figure. It never drops a late packet,
    // it stalls everything queued behind it until the retransmit lands, and
    // covering a retransmit needs more room than covering a hiccup.
    expect(jitterTargetMs("audio", relay("tcp"), false)).toBe(
      AUDIO_JITTER_TARGET_MS + TCP_RELAY_EXTRA_MS,
    );
  });

  it("substantially shortens every bad-route target while duetting", () => {
    for (const route of [direct(300), relay("udp"), relay("tcp")]) {
      for (const kind of ["audio", "video"] as const) {
        const ordinary = jitterTargetMs(kind, route, false);
        const duetting = jitterTargetMs(kind, route, true);
        expect(ordinary).not.toBeNull();
        expect(duetting).not.toBeNull();
        if (ordinary === null || duetting === null) {
          throw new Error("bad routes must have a jitter target");
        }
        expect(duetting).toBe(ordinary * DUETTING_JITTER_TARGET_FACTOR);
        expect(duetting).toBeGreaterThan(0);
      }
    }
  });

  it("caps an extreme finite RTT at the sane maximum", () => {
    expect(jitterTargetMs("audio", direct(1_000_000), false)).toBe(
      MAX_JITTER_TARGET_MS,
    );
  });

  it("never returns an invalid target for malformed RTT measurements", () => {
    for (const netRttMs of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const target = jitterTargetMs("audio", direct(netRttMs), false);
      expect(target).not.toBeNull();
      expect(Number.isFinite(target)).toBe(true);
      expect(target).toBeGreaterThanOrEqual(0);
      expect(target).toBeLessThanOrEqual(MAX_JITTER_TARGET_MS);
    }
  });

  it("never lowers a target as a route becomes worse", () => {
    const routes = [direct(null), direct(150), direct(151), relay("udp"), relay("tcp"), direct(1_000_000)];

    for (const kind of ["audio", "video"] as const) {
      for (const duetting of [false, true]) {
        const targets = routes.map((route) => jitterTargetMs(kind, route, duetting));
        for (let i = 1; i < targets.length; i += 1) {
          expect(targets[i]).toBeGreaterThanOrEqual(targets[i - 1] ?? 0);
        }
      }
    }
  });
});

describe("applyJitterTarget", () => {
  it("does not touch a receiver when the policy leaves the browser alone", () => {
    const receiver: ReceiverLike = { jitterBufferTarget: 17 };

    expect(applyJitterTarget(receiver, null)).toBe(false);
    expect(receiver.jitterBufferTarget).toBe(17);
  });

  it("does not touch a receiver that has no jitter-buffer property", () => {
    const receiver: ReceiverLike = {};

    expect(applyJitterTarget(receiver, 180)).toBe(false);
    expect("jitterBufferTarget" in receiver).toBe(false);
  });

  it("assigns a supported writable property and absorbs assignment failures", () => {
    const writable: ReceiverLike = { jitterBufferTarget: null };
    expect(applyJitterTarget(writable, 180)).toBe(true);
    expect(writable.jitterBufferTarget).toBe(180);

    const rejecting = Object.defineProperty({}, "jitterBufferTarget", {
      set: () => {
        throw new Error("unsupported");
      },
    }) as ReceiverLike;
    expect(applyJitterTarget(rejecting, 180)).toBe(false);
  });
});

/**
 * TCP will not drop a late packet, it holds everything behind it until the
 * retransmit lands. Covering that costs more room than covering a hiccup, so a
 * TCP relay must never be given a shallower buffer than a UDP one.
 */
describe("a relay reached over TCP", () => {
  const tcp: BufferRoute = { relayed: true, relayProtocol: "tcp", netRttMs: 270 };
  const udp: BufferRoute = { relayed: true, relayProtocol: "udp", netRttMs: 270 };
  const tls: BufferRoute = { relayed: true, relayProtocol: "tls", netRttMs: 270 };

  it("asks for more margin than the same relay over UDP", () => {
    const overTcp = jitterTargetMs("audio", tcp, false);
    const overUdp = jitterTargetMs("audio", udp, false);
    expect(overTcp).not.toBeNull();
    expect(overUdp).not.toBeNull();
    expect(overTcp as number).toBeGreaterThan(overUdp as number);
  });

  it("treats TLS the same, since it is carried over TCP", () => {
    expect(jitterTargetMs("audio", tls, false)).toBe(jitterTargetMs("audio", tcp, false));
  });

  it("still respects the maximum", () => {
    const far: BufferRoute = { relayed: true, relayProtocol: "tcp", netRttMs: 9_000 };
    expect(jitterTargetMs("video", far, false)).toBeLessThanOrEqual(MAX_JITTER_TARGET_MS);
  });

  it("does not surcharge a direct route that merely reports a protocol", () => {
    const oddly: BufferRoute = { relayed: false, relayProtocol: "tcp", netRttMs: 300 };
    expect(jitterTargetMs("audio", oddly, false)).toBe(AUDIO_JITTER_TARGET_MS);
  });
});
