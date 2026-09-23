import { describe, expect, it, vi } from "vitest";
import {
  advanceHeadroom,
  advanceLeashHealth,
  capToHeadroom,
  headroomCapBps,
  HEADROOM_FLOOR_BPS,
  leashChanged,
  profileFor,
  applyAudioPriority,
  applyLeash,
  budgetFor,
  CONSTRAINED_FULL_VIDEO,
  CONSTRAINED_LEAN_VIDEO,
  FULL_VIDEO,
  healthStep,
  INITIAL_LEASH_HEALTH,
  LEASH_MOVE_COOLDOWN_MS,
  leashFor,
  leashSenders,
  RELAYED_FULL_VIDEO,
  sameSettings,
  SQUEEZED_FULL_VIDEO,
  SQUEEZED_LEAN_VIDEO,
  LEAN_VIDEO,
  type LeashHealthState,
  type LeashLevel,
  type EncodingLike,
  type SenderLike,
  type SenderParamsLike,
} from "./videoLeash";

/**
 * A real browser's send parameters carry far more than encodings -- codecs, a
 * transactionId, degradation preferences. The fake accepts those extras so the
 * tests can prove the leash leaves them alone, which is the whole reason this
 * module mutates the object it was given instead of building a fresh one.
 */
type FakeParams = SenderParamsLike & Record<string, unknown>;

function fakeSender(params: FakeParams = {}, kind = "video", reject = false) {
  // Typed rather than given a named parameter: the call signature is what
  // lets the identity assertion below read mock.calls[0][0] at all.
  const setParameters = vi.fn<(next: SenderParamsLike) => Promise<void>>(() =>
    reject
      ? Promise.reject(new Error("quality change refused"))
      : Promise.resolve(),
  );
  const sender: SenderLike = {
    track: { kind },
    getParameters: () => params,
    setParameters,
  };
  return { sender, params, setParameters };
}

describe("video leash settings", () => {
  it("defines the full camera budget", () => {
    expect(FULL_VIDEO).toEqual({
      maxBitrateBps: 2_500_000,
      scaleResolutionDownBy: 1,
      maxFramerate: 30,
    });
  });

  it("defines the karaoke camera budget", () => {
    expect(LEAN_VIDEO).toEqual({
      maxBitrateBps: 500_000,
      scaleResolutionDownBy: 2,
      maxFramerate: 24,
    });
  });

  it("selects the matching budget", () => {
    expect(leashFor("full")).toBe(FULL_VIDEO);
    expect(leashFor("lean")).toBe(LEAN_VIDEO);
  });
});

describe("route-aware video budgets", () => {
  it("uses the activity budget until a route has been measured", () => {
    expect(budgetFor("full", null)).toBe(FULL_VIDEO);
    expect(budgetFor("lean", null)).toBe(LEAN_VIDEO);
  });

  it("leaves close direct routes on their activity budgets", () => {
    const route = { relayed: false, relayProtocol: null, netRttMs: 90 };
    expect(budgetFor("full", route)).toBe(FULL_VIDEO);
    expect(budgetFor("lean", route)).toBe(LEAN_VIDEO);
  });

  it("constrains a long direct route exactly as it would a slow relay", () => {
    // The measured evening: direct UDP, 292 ms, and a voice buffered for over
    // 300 ms because 2.5 Mbps of camera was filling the smaller home uplink.
    const route = { relayed: false, relayProtocol: null, netRttMs: 292 };
    expect(budgetFor("full", route)).toBe(CONSTRAINED_FULL_VIDEO);
    expect(budgetFor("lean", route)).toBe(CONSTRAINED_LEAN_VIDEO);
  });

  it("keeps a direct route with no RTT yet on its activity budget", () => {
    expect(
      budgetFor("full", {
        relayed: false,
        relayProtocol: null,
        netRttMs: null,
      }),
    ).toBe(FULL_VIDEO);
  });

  it("constrains a TCP relay without reducing full-video resolution", () => {
    expect(
      budgetFor("full", { relayed: true, relayProtocol: "tcp", netRttMs: 50 }),
    ).toBe(CONSTRAINED_FULL_VIDEO);
    expect(CONSTRAINED_FULL_VIDEO).toMatchObject({
      maxBitrateBps: 900_000,
      scaleResolutionDownBy: 1,
    });
  });

  it("constrains a slow relay and keeps lean no more generous than full", () => {
    const route = { relayed: true, relayProtocol: "udp", netRttMs: 151 };
    expect(budgetFor("full", route)).toBe(CONSTRAINED_FULL_VIDEO);
    expect(budgetFor("lean", route)).toBe(CONSTRAINED_LEAN_VIDEO);
    expect(CONSTRAINED_LEAN_VIDEO.maxBitrateBps).toBeLessThanOrEqual(
      CONSTRAINED_FULL_VIDEO.maxBitrateBps,
    );
    expect(CONSTRAINED_LEAN_VIDEO.maxFramerate).toBeLessThanOrEqual(
      CONSTRAINED_FULL_VIDEO.maxFramerate,
    );
  });

  it("uses an intermediate budget for a fast non-TCP relay", () => {
    const route = { relayed: true, relayProtocol: "udp", netRttMs: 100 };
    const full = budgetFor("full", route);
    const lean = budgetFor("lean", route);
    expect(full.maxBitrateBps).toBeLessThan(FULL_VIDEO.maxBitrateBps);
    expect(full.maxBitrateBps).toBeGreaterThan(
      CONSTRAINED_FULL_VIDEO.maxBitrateBps,
    );
    expect(lean.maxBitrateBps).toBeLessThanOrEqual(LEAN_VIDEO.maxBitrateBps);
    expect(lean.maxBitrateBps).toBeGreaterThanOrEqual(
      CONSTRAINED_LEAN_VIDEO.maxBitrateBps,
    );
    expect(lean.maxBitrateBps).toBeLessThanOrEqual(full.maxBitrateBps);
  });
});

describe("applyLeash", () => {
  it("skips an audio sender", async () => {
    const { sender, setParameters } = fakeSender({}, "audio");
    await expect(applyLeash(sender, LEAN_VIDEO)).resolves.toBe(false);
    expect(setParameters).not.toHaveBeenCalled();
  });

  it("skips a sender with no track", async () => {
    const { sender, setParameters } = fakeSender();
    sender.track = null;
    await expect(applyLeash(sender, LEAN_VIDEO)).resolves.toBe(false);
    expect(setParameters).not.toHaveBeenCalled();
  });

  it("creates an encoding when the array is missing", async () => {
    const { sender, params } = fakeSender({ codec: "VP8" });
    await expect(applyLeash(sender, LEAN_VIDEO)).resolves.toBe(true);
    expect(params.encodings).toEqual([
      {
        maxBitrate: 500_000,
        scaleResolutionDownBy: 2,
        maxFramerate: 24,
      },
    ]);
    expect(params.degradationPreference).toBe("maintain-resolution");
  });

  it("creates an encoding when the array is empty", async () => {
    const { sender, params } = fakeSender({ encodings: [] });
    await applyLeash(sender, FULL_VIDEO);
    expect(params.encodings).toEqual([
      {
        maxBitrate: 2_500_000,
        scaleResolutionDownBy: 1,
        maxFramerate: 30,
      },
    ]);
  });

  it("caps every encoding in a simulcast sender", async () => {
    const encodings = [
      { rid: "low", maxBitrate: 100_000 },
      { rid: "high", maxBitrate: 4_000_000 },
    ];
    const { sender } = fakeSender({ encodings });
    await applyLeash(sender, LEAN_VIDEO);
    expect(encodings).toEqual([
      {
        rid: "low",
        maxBitrate: 500_000,
        scaleResolutionDownBy: 2,
        maxFramerate: 24,
      },
      {
        rid: "high",
        maxBitrate: 500_000,
        scaleResolutionDownBy: 2,
        maxFramerate: 24,
      },
    ]);
  });

  it("passes the exact parameters object returned by getParameters", async () => {
    const { sender, params, setParameters } = fakeSender({ encodings: [{}] });
    await applyLeash(sender, LEAN_VIDEO);
    expect(setParameters).toHaveBeenCalledWith(params);
    expect(setParameters.mock.calls[0]?.[0]).toBe(params);
  });

  it("preserves unrelated sender parameters", async () => {
    const params = { transactionId: "kept", encodings: [{}] };
    const { sender } = fakeSender(params);
    await applyLeash(sender, LEAN_VIDEO);
    expect(params.transactionId).toBe("kept");
  });

  it("returns false when setParameters rejects", async () => {
    const { sender } = fakeSender({ encodings: [{}] }, "video", true);
    await expect(applyLeash(sender, LEAN_VIDEO)).resolves.toBe(false);
  });

  it("still applies bitrate when optional browser priority fields reject writes", async () => {
    const encoding: EncodingLike = {};
    const params: FakeParams = { encodings: [encoding] };
    Object.defineProperty(encoding, "networkPriority", {
      set: () => {
        throw new Error("unsupported");
      },
    });
    Object.defineProperty(params, "degradationPreference", {
      set: () => {
        throw new Error("unsupported");
      },
    });
    const { sender, setParameters } = fakeSender(params);

    await expect(applyLeash(sender, CONSTRAINED_FULL_VIDEO)).resolves.toBe(
      true,
    );
    expect(encoding.maxBitrate).toBe(900_000);
    // The video encoding carries no priority of its own any more: "low" is an
    // instruction to the bandwidth allocator, not a hint, and on a contended
    // link it could squeeze the camera down to nothing.
    expect(encoding.priority).toBeUndefined();
    expect(setParameters).toHaveBeenCalledWith(params);
  });
});

describe("applyAudioPriority", () => {
  it("gives an audio encoding high network priority", async () => {
    const { sender, params } = fakeSender({ encodings: [{}] }, "audio");
    await expect(applyAudioPriority(sender)).resolves.toBe(true);
    expect(params.encodings).toEqual([
      { networkPriority: "high", priority: "high" },
    ]);
  });

  it("creates an audio encoding when the browser has not supplied one", async () => {
    const { sender, params } = fakeSender({}, "audio");
    await expect(applyAudioPriority(sender)).resolves.toBe(true);
    expect(params.encodings).toEqual([
      { networkPriority: "high", priority: "high" },
    ]);
  });

  it("skips non-audio senders", async () => {
    const { sender, setParameters } = fakeSender({}, "video");
    await expect(applyAudioPriority(sender)).resolves.toBe(false);
    expect(setParameters).not.toHaveBeenCalled();
  });

  it("returns false when applying priority is rejected", async () => {
    const { sender } = fakeSender({ encodings: [{}] }, "audio", true);
    await expect(applyAudioPriority(sender)).resolves.toBe(false);
  });
});

describe("leashSenders", () => {
  it("counts changes and continues after one sender rejects", async () => {
    const first = fakeSender({ encodings: [{}] });
    const refused = fakeSender({ encodings: [{}] }, "video", true);
    const audio = fakeSender({}, "audio");
    const last = fakeSender({ encodings: [{}] });

    await expect(
      leashSenders(
        [first.sender, refused.sender, audio.sender, last.sender],
        "lean",
      ),
    ).resolves.toBe(2);
    expect(first.setParameters).toHaveBeenCalledOnce();
    // Twice, not once: a refusal is retried once without the degradation
    // preference, in case the hint was the only thing the sender objected to.
    // Only after that second refusal is the budget genuinely given up on.
    expect(refused.setParameters).toHaveBeenCalledTimes(2);
    expect(last.setParameters).toHaveBeenCalledOnce();
  });

  it("applies the full budget to every eligible sender", async () => {
    const first = fakeSender({ encodings: [{}] });
    const second = fakeSender({ encodings: [{}] });
    await expect(
      leashSenders([first.sender, second.sender], "full"),
    ).resolves.toBe(2);
    expect(first.params.encodings?.[0]?.maxBitrate).toBe(2_500_000);
    expect(second.params.encodings?.[0]?.maxFramerate).toBe(30);
  });

  it("applies the route-aware budget when a route is supplied", async () => {
    const video = fakeSender({ encodings: [{}] });
    await expect(
      leashSenders([video.sender], "full", {
        relayed: true,
        relayProtocol: "tcp",
        netRttMs: 100,
      }),
    ).resolves.toBe(1);
    expect(video.params.encodings?.[0]?.maxBitrate).toBe(900_000);
  });

  it("returns zero when no sender can be changed", async () => {
    const audio = fakeSender({}, "audio");
    const missing = fakeSender({ encodings: [{}] }, "video", true);
    await expect(
      leashSenders([audio.sender, missing.sender], "lean"),
    ).resolves.toBe(0);
  });

  it("handles an empty sender list", async () => {
    await expect(leashSenders([], "full")).resolves.toBe(0);
  });

  it("does not call parameters for null-track senders in a batch", async () => {
    const nullTrack = fakeSender();
    nullTrack.sender.track = null;
    const video = fakeSender({ encodings: [{}] });
    await leashSenders([nullTrack.sender, video.sender], "lean");
    expect(nullTrack.setParameters).not.toHaveBeenCalled();
    expect(video.setParameters).toHaveBeenCalledOnce();
  });
});

/**
 * The degradation preference is a hint; the bitrate cap is the reason this
 * module exists. A browser that refuses the hint rejects the whole
 * setParameters call, so without a retry the camera would be left running
 * completely uncapped by the very code meant to cap it.
 */
describe("a browser that refuses the degradation preference", () => {
  function pickySender() {
    const params: FakeParams = { encodings: [{}] };
    const setParameters = vi.fn(async (next: SenderParamsLike) => {
      if (next.degradationPreference !== undefined) {
        throw new Error("degradationPreference not supported");
      }
    });
    const sender: SenderLike = {
      track: { kind: "video" },
      getParameters: () => params,
      setParameters,
    };
    return { sender, params, setParameters };
  }

  it("still applies the bitrate cap", async () => {
    const picky = pickySender();
    await expect(
      applyLeash(picky.sender, CONSTRAINED_FULL_VIDEO),
    ).resolves.toBe(true);
    expect(picky.params.encodings?.[0]?.maxBitrate).toBe(
      CONSTRAINED_FULL_VIDEO.maxBitrateBps,
    );
  });

  it("retries exactly once, without the preference", async () => {
    const picky = pickySender();
    await applyLeash(picky.sender, FULL_VIDEO);
    expect(picky.setParameters).toHaveBeenCalledTimes(2);
    expect(picky.params.degradationPreference).toBeUndefined();
  });

  it("gives up when the sender refuses even the plain budget", async () => {
    const params: FakeParams = { encodings: [{}] };
    const sender: SenderLike = {
      track: { kind: "video" },
      getParameters: () => params,
      setParameters: vi.fn(async () => {
        throw new Error("no");
      }),
    };
    await expect(applyLeash(sender, FULL_VIDEO)).resolves.toBe(false);
  });
});

/**
 * The encoder must be left alone unless the answer has actually changed.
 *
 * The route is derived from a live RTT measurement that wobbles by tens of
 * milliseconds between polls. Treating every wobble as a new route re-applied
 * setParameters to a running encoder every few seconds, which forces a
 * reconfiguration and a keyframe each time -- bandwidth spent re-describing a
 * picture that had not changed, on a link already too small for the call.
 */
describe("sameSettings", () => {
  it("recognises two identical budgets", () => {
    expect(sameSettings(FULL_VIDEO, { ...FULL_VIDEO })).toBe(true);
  });

  it("sees through routes that differ but decide the same thing", () => {
    // 266ms and 352ms are both "relayed, slow, over TCP". The measurement
    // moved; the decision did not, so the encoder must not be touched.
    const noisy = (netRttMs: number) =>
      budgetFor("full", {
        relayed: true,
        relayProtocol: "tcp",
        netRttMs,
      });
    expect(sameSettings(noisy(266), noisy(352))).toBe(true);
  });

  it("still notices a real change of budget", () => {
    const relayed = budgetFor("full", {
      relayed: true,
      relayProtocol: "tcp",
      netRttMs: 300,
    });
    const direct = budgetFor("full", {
      relayed: false,
      relayProtocol: null,
      netRttMs: 20,
    });
    expect(sameSettings(relayed, direct)).toBe(false);
  });

  it("compares every field that reaches the encoder", () => {
    expect(sameSettings(FULL_VIDEO, { ...FULL_VIDEO, maxBitrateBps: 1 })).toBe(
      false,
    );
    expect(sameSettings(FULL_VIDEO, { ...FULL_VIDEO, maxFramerate: 1 })).toBe(
      false,
    );
    expect(
      sameSettings(FULL_VIDEO, { ...FULL_VIDEO, scaleResolutionDownBy: 4 }),
    ).toBe(false);
  });
});

describe("squeezed budgets", () => {
  it("defines the squeezed full-video budget", () => {
    expect(SQUEEZED_FULL_VIDEO).toEqual({
      maxBitrateBps: 450_000,
      scaleResolutionDownBy: 2,
      maxFramerate: 20,
    });
  });

  it("defines the squeezed karaoke budget", () => {
    expect(SQUEEZED_LEAN_VIDEO).toEqual({
      maxBitrateBps: 300_000,
      scaleResolutionDownBy: 2,
      maxFramerate: 15,
    });
  });

  it("is tighter than the constrained budget it follows", () => {
    expect(SQUEEZED_FULL_VIDEO.maxBitrateBps).toBeLessThan(
      CONSTRAINED_FULL_VIDEO.maxBitrateBps,
    );
    expect(SQUEEZED_LEAN_VIDEO.maxBitrateBps).toBeLessThan(
      CONSTRAINED_LEAN_VIDEO.maxBitrateBps,
    );
    expect(SQUEEZED_LEAN_VIDEO.maxBitrateBps).toBeLessThanOrEqual(
      SQUEEZED_FULL_VIDEO.maxBitrateBps,
    );
  });
});

describe("healthStep", () => {
  it("tightens when the voice is buffered far too long", () => {
    expect(healthStep(0, { audioJitterMs: 314, audioLossPct: 0.7 })).toBe(1);
    expect(healthStep(1, { audioJitterMs: 314, audioLossPct: 0.7 })).toBe(2);
  });

  it("tightens on loss alone", () => {
    expect(healthStep(0, { audioJitterMs: 40, audioLossPct: 2.5 })).toBe(1);
  });

  it("holds in the band between the two thresholds", () => {
    expect(healthStep(0, { audioJitterMs: 100, audioLossPct: 0.7 })).toBe(0);
    expect(healthStep(1, { audioJitterMs: 100, audioLossPct: 0.7 })).toBe(1);
    expect(healthStep(2, { audioJitterMs: 100, audioLossPct: 0.7 })).toBe(2);
  });

  it("loosens only when the voice is clearly well", () => {
    expect(healthStep(2, { audioJitterMs: 60, audioLossPct: 0.1 })).toBe(1);
    expect(healthStep(1, { audioJitterMs: 60, audioLossPct: 0.1 })).toBe(0);
    // Low buffering with noticeable loss is not well.
    expect(healthStep(1, { audioJitterMs: 60, audioLossPct: 0.7 })).toBe(1);
  });

  it("never loosens below zero or tightens above two", () => {
    expect(healthStep(0, { audioJitterMs: 60, audioLossPct: 0.1 })).toBe(0);
    expect(healthStep(2, { audioJitterMs: 314, audioLossPct: 5 })).toBe(2);
  });

  it("does not treat missing readings as health", () => {
    expect(healthStep(1, { audioJitterMs: null, audioLossPct: null })).toBe(1);
    expect(healthStep(1, { audioJitterMs: 60, audioLossPct: null })).toBe(1);
  });
});

describe("budgetFor with a health level", () => {
  const routes = [
    null,
    { relayed: false, relayProtocol: null, netRttMs: 40 },
    { relayed: false, relayProtocol: null, netRttMs: 292 },
    { relayed: true, relayProtocol: "udp", netRttMs: 100 },
    { relayed: true, relayProtocol: "tcp", netRttMs: 100 },
    { relayed: true, relayProtocol: "udp", netRttMs: 300 },
  ];
  const levels: LeashLevel[] = [0, 1, 2];

  it("is never looser than the route alone allows", () => {
    for (const mode of ["full", "lean"] as const) {
      for (const route of routes) {
        const byRoute = budgetFor(mode, route);
        for (const level of levels) {
          const budget = budgetFor(mode, route, level);
          expect(budget.maxBitrateBps).toBeLessThanOrEqual(
            byRoute.maxBitrateBps,
          );
          expect(budget.maxFramerate).toBeLessThanOrEqual(byRoute.maxFramerate);
        }
      }
    }
  });

  it("applies the level on a route that would otherwise run free", () => {
    const close = { relayed: false, relayProtocol: null, netRttMs: 40 };
    expect(budgetFor("full", close, 0)).toBe(FULL_VIDEO);
    expect(budgetFor("full", close, 1)).toBe(CONSTRAINED_FULL_VIDEO);
    expect(budgetFor("full", close, 2)).toBe(SQUEEZED_FULL_VIDEO);
    expect(budgetFor("lean", close, 2)).toBe(SQUEEZED_LEAN_VIDEO);
  });

  it("lets level 1 add nothing where the route already constrains", () => {
    const far = { relayed: false, relayProtocol: null, netRttMs: 292 };
    expect(budgetFor("full", far, 1)).toBe(CONSTRAINED_FULL_VIDEO);
    expect(budgetFor("full", far, 2)).toBe(SQUEEZED_FULL_VIDEO);
  });

  it("keeps the close-relay budget at level 0", () => {
    expect(
      budgetFor(
        "full",
        { relayed: true, relayProtocol: "udp", netRttMs: 100 },
        0,
      ),
    ).toBe(RELAYED_FULL_VIDEO);
  });

  it("passes the level through leashSenders", async () => {
    const video = fakeSender({ encodings: [{}] });
    await leashSenders([video.sender], "full", null, 2);
    expect(video.params.encodings?.[0]?.maxBitrate).toBe(450_000);
  });
});

describe("advanceLeashHealth", () => {
  const bad = { audioJitterMs: 314, audioLossPct: 0.7 };
  const good = { audioJitterMs: 60, audioLossPct: 0.1 };
  const middling = { audioJitterMs: 100, audioLossPct: 0.7 };

  it("does not move on a single bad poll", () => {
    const next = advanceLeashHealth(INITIAL_LEASH_HEALTH, bad, 0);
    expect(next.level).toBe(0);
    expect(next.pending).toBe(1);
  });

  it("moves one level after two bad polls in a row", () => {
    const first = advanceLeashHealth(INITIAL_LEASH_HEALTH, bad, 0);
    const second = advanceLeashHealth(first, bad, 3_000);
    expect(second).toEqual({
      level: 1,
      pending: 0,
      movedAtMs: 3_000,
      capKbps: null,
    });
  });

  it("forgets a pending move when a poll in between disagrees", () => {
    let state = advanceLeashHealth(INITIAL_LEASH_HEALTH, bad, 0);
    state = advanceLeashHealth(state, middling, 3_000);
    state = advanceLeashHealth(state, bad, 6_000);
    expect(state.level).toBe(0);
    expect(state.pending).toBe(1);
  });

  it("never moves again within the cooldown", () => {
    let state: LeashHealthState = {
      level: 1,
      pending: 0,
      movedAtMs: 0,
      capKbps: null,
    };
    state = advanceLeashHealth(state, bad, 3_000);
    state = advanceLeashHealth(state, bad, 6_000);
    expect(state.level).toBe(1);
    state = advanceLeashHealth(state, bad, LEASH_MOVE_COOLDOWN_MS);
    expect(state.level).toBe(2);
    expect(state.movedAtMs).toBe(LEASH_MOVE_COOLDOWN_MS);
  });

  it("loosens only after two healthy polls and the cooldown", () => {
    let state: LeashHealthState = {
      level: 2,
      pending: 0,
      movedAtMs: 0,
      capKbps: null,
    };
    state = advanceLeashHealth(state, good, 12_000);
    state = advanceLeashHealth(state, good, 15_000);
    expect(state.level).toBe(1);
    state = advanceLeashHealth(state, good, 18_000);
    state = advanceLeashHealth(state, good, 21_000);
    expect(state.level).toBe(1);
    state = advanceLeashHealth(state, good, 30_000);
    expect(state.level).toBe(0);
  });

  it("stays put at the edges", () => {
    let state = advanceLeashHealth(INITIAL_LEASH_HEALTH, good, 0);
    state = advanceLeashHealth(state, good, 3_000);
    expect(state).toEqual(INITIAL_LEASH_HEALTH);
    let top: LeashHealthState = {
      level: 2,
      pending: 0,
      movedAtMs: 0,
      capKbps: null,
    };
    top = advanceLeashHealth(top, bad, 30_000);
    top = advanceLeashHealth(top, bad, 33_000);
    expect(top.level).toBe(2);
  });
});

describe("healthStep on what the other side reports", () => {
  const theirs = (audioJitterMs: number, audioLossPct: number) => ({
    audioJitterMs,
    audioLossPct,
    source: "their-report" as const,
  });

  it("tightens on interarrival jitter far below a buffer-sized figure", () => {
    // Interarrival jitter is a few ms on a healthy call. 40 ms is packets
    // queueing behind our camera, even though it is nowhere near 150.
    expect(healthStep(0, theirs(40, 0.1))).toBe(1);
    expect(healthStep(0, { audioJitterMs: 40, audioLossPct: 0.1 })).toBe(0);
  });

  it("tightens on the loss they report", () => {
    expect(healthStep(1, theirs(5, 5.3))).toBe(2);
  });

  it("holds between its own thresholds", () => {
    expect(healthStep(1, theirs(20, 0.1))).toBe(1);
  });

  it("loosens only when their view is clearly clean", () => {
    expect(healthStep(1, theirs(8, 0.1))).toBe(0);
  });

  it("drives the two-poll machine like the fallback does", () => {
    let state = advanceLeashHealth(INITIAL_LEASH_HEALTH, theirs(45, 3), 0);
    expect(state.level).toBe(0);
    state = advanceLeashHealth(state, theirs(45, 3), 3_000);
    expect(state.level).toBe(1);
  });
});

describe("headroomCapBps", () => {
  it("is null only when there is no estimate at all", () => {
    expect(headroomCapBps(null)).toBeNull();
    expect(headroomCapBps(Number.NaN)).toBeNull();
  });

  it("gives the floor, never null, when the estimate cannot even carry the voice", () => {
    expect(headroomCapBps(40)).toBe(HEADROOM_FLOOR_BPS);
    expect(headroomCapBps(0)).toBe(80_000);
  });

  it("floors the relayed evening's 145 kbps at 80 kbps", () => {
    expect(headroomCapBps(145)).toBe(80_000);
  });

  it("leaves the voice and a margin out of a 695 kbps estimate", () => {
    expect(headroomCapBps(695)).toBe(599_000);
  });

  it("accounts for a voice that needs more than the default", () => {
    expect(headroomCapBps(695, 128)).toBe(535_000);
  });
});

describe("capToHeadroom", () => {
  it("shrinks and slows the picture under 250 kbps", () => {
    expect(capToHeadroom(CONSTRAINED_LEAN_VIDEO, headroomCapBps(145))).toEqual({
      maxBitrateBps: 80_000,
      scaleResolutionDownBy: 4,
      maxFramerate: 12,
    });
  });

  it("keeps the budget's shape when the cap is comfortably large", () => {
    expect(capToHeadroom(FULL_VIDEO, headroomCapBps(695))).toEqual({
      maxBitrateBps: 599_000,
      scaleResolutionDownBy: 1,
      maxFramerate: 30,
    });
  });

  it("has no effect on full video when the estimate is ample", () => {
    expect(capToHeadroom(FULL_VIDEO, headroomCapBps(3485))).toBe(FULL_VIDEO);
  });

  it("changes nothing without an estimate", () => {
    expect(capToHeadroom(FULL_VIDEO, null)).toBe(FULL_VIDEO);
  });

  it("is what budgetFor applies on top of the route and the level", () => {
    const far = { relayed: true, relayProtocol: "udp", netRttMs: 1390 };
    expect(budgetFor("lean", far, 0, headroomCapBps(145))).toEqual({
      maxBitrateBps: 80_000,
      scaleResolutionDownBy: 4,
      maxFramerate: 12,
    });
    expect(budgetFor("full", far, 0, null)).toBe(CONSTRAINED_FULL_VIDEO);
  });

  it("ignores the estimate on a healthy direct route, so the cap cannot feed itself", () => {
    // Chrome's estimate settles near what is sent when the encoder is held
    // below it. On a direct call with no sign of trouble the cap stays out.
    const near = { relayed: false, relayProtocol: null, netRttMs: 40 };
    expect(budgetFor("full", near, 0, headroomCapBps(145))).toBe(FULL_VIDEO);
    // Evidence of trouble lets it back in: a stepped-up health level...
    expect(budgetFor("full", near, 1, headroomCapBps(145)).maxBitrateBps).toBe(80_000);
    // ...or a relay.
    const relayed = { relayed: true, relayProtocol: "udp", netRttMs: 40 };
    expect(budgetFor("full", relayed, 0, headroomCapBps(145)).maxBitrateBps).toBe(80_000);
  });

  it("never loosens a budget, whatever the estimate", () => {
    for (const kbps of [0, 145, 400, 695, 1200, 3485, 10_000]) {
      const capped = capToHeadroom(SQUEEZED_LEAN_VIDEO, headroomCapBps(kbps));
      expect(capped.maxBitrateBps).toBeLessThanOrEqual(
        SQUEEZED_LEAN_VIDEO.maxBitrateBps,
      );
      expect(capped.maxFramerate).toBeLessThanOrEqual(
        SQUEEZED_LEAN_VIDEO.maxFramerate,
      );
    }
  });
});

describe("leashChanged", () => {
  const applied = (kbps: number) => ({
    profile: FULL_VIDEO,
    settings: capToHeadroom(FULL_VIDEO, headroomCapBps(kbps)),
  });

  it("always applies the first budget", () => {
    expect(leashChanged(null, applied(695))).toBe(true);
  });

  it("ignores a cap that moved by a fifth or less", () => {
    // 599 kbps to 649 kbps is about 8%: not worth a keyframe.
    expect(leashChanged(applied(695), applied(745))).toBe(false);
  });

  it("applies a cap that moved by more than a fifth", () => {
    expect(leashChanged(applied(695), applied(400))).toBe(true);
  });

  it("applies any change of picture size or framerate", () => {
    // 80 kbps and 150 kbps are both "tiny", but 300 is not.
    expect(leashChanged(applied(145), applied(396))).toBe(true);
  });

  it("applies any change of named budget", () => {
    expect(
      leashChanged(
        { profile: FULL_VIDEO, settings: FULL_VIDEO },
        { profile: profileFor("lean", null), settings: LEAN_VIDEO },
      ),
    ).toBe(true);
  });
});

describe("advanceHeadroom", () => {
  it("adopts the first estimate, bucketed, without stamping the cooldown", () => {
    const next = advanceHeadroom(INITIAL_LEASH_HEALTH, 695, 1_000);
    expect(next.capKbps).toBe(700);
    expect(next.movedAtMs).toBeNull();
  });

  it("treats a wobble inside one bucket as no movement at all", () => {
    const state = advanceHeadroom(INITIAL_LEASH_HEALTH, 695, 0);
    expect(advanceHeadroom(state, 712, 3_000)).toBe(state);
    expect(advanceHeadroom(state, 688, 6_000)).toBe(state);
  });

  it("falls at once", () => {
    const state = advanceHeadroom(INITIAL_LEASH_HEALTH, 695, 0);
    const fallen = advanceHeadroom(state, 145, 3_000);
    expect(fallen.capKbps).toBe(150);
    expect(fallen.movedAtMs).toBe(3_000);
  });

  it("rises only after the shared cooldown", () => {
    let state = advanceHeadroom(INITIAL_LEASH_HEALTH, 695, 0);
    state = advanceHeadroom(state, 145, 3_000);
    expect(advanceHeadroom(state, 695, 6_000).capKbps).toBe(150);
    expect(
      advanceHeadroom(state, 695, 3_000 + LEASH_MOVE_COOLDOWN_MS).capKbps,
    ).toBe(700);
  });

  it("waits out a move of the health level before rising", () => {
    const state: LeashHealthState = {
      level: 1,
      pending: 0,
      movedAtMs: 10_000,
      capKbps: 150,
    };
    expect(advanceHeadroom(state, 700, 12_000).capKbps).toBe(150);
  });

  it("keeps the cap when the estimate goes missing", () => {
    const state = advanceHeadroom(INITIAL_LEASH_HEALTH, 145, 0);
    expect(advanceHeadroom(state, null, 3_000)).toBe(state);
  });

  it("is kept by the health machine as it moves", () => {
    const state: LeashHealthState = { ...INITIAL_LEASH_HEALTH, capKbps: 150 };
    const bad = { audioJitterMs: 314, audioLossPct: 0.7 };
    let next = advanceLeashHealth(state, bad, 0);
    next = advanceLeashHealth(next, bad, 3_000);
    expect(next.level).toBe(1);
    expect(next.capKbps).toBe(150);
  });
});
