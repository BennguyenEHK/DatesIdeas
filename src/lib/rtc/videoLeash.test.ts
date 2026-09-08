import { describe, expect, it, vi } from "vitest";
import {
  applyAudioPriority,
  applyLeash,
  budgetFor,
  CONSTRAINED_FULL_VIDEO,
  CONSTRAINED_LEAN_VIDEO,
  FULL_VIDEO,
  leashFor,
  leashSenders,
  LEAN_VIDEO,
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

function fakeSender(
  params: FakeParams = {},
  kind = "video",
  reject = false,
) {
  // Typed rather than given a named parameter: the call signature is what
  // lets the identity assertion below read mock.calls[0][0] at all.
  const setParameters = vi.fn<(next: SenderParamsLike) => Promise<void>>(() =>
    reject ? Promise.reject(new Error("quality change refused")) : Promise.resolve(),
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

  it("leaves direct routes on their activity budgets", () => {
    expect(
      budgetFor("full", { relayed: false, relayProtocol: "tcp", netRttMs: 400 }),
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
    expect(full.maxBitrateBps).toBeGreaterThan(CONSTRAINED_FULL_VIDEO.maxBitrateBps);
    expect(lean.maxBitrateBps).toBeLessThanOrEqual(LEAN_VIDEO.maxBitrateBps);
    expect(lean.maxBitrateBps).toBeGreaterThanOrEqual(CONSTRAINED_LEAN_VIDEO.maxBitrateBps);
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
        networkPriority: "low",
        priority: "low",
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
        networkPriority: "low",
        priority: "low",
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
        networkPriority: "low",
        priority: "low",
      },
      {
        rid: "high",
        maxBitrate: 500_000,
        scaleResolutionDownBy: 2,
        maxFramerate: 24,
        networkPriority: "low",
        priority: "low",
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

    await expect(applyLeash(sender, CONSTRAINED_FULL_VIDEO)).resolves.toBe(true);
    expect(encoding.maxBitrate).toBe(900_000);
    expect(encoding.priority).toBe("low");
    expect(setParameters).toHaveBeenCalledWith(params);
  });
});

describe("applyAudioPriority", () => {
  it("gives an audio encoding high network priority", async () => {
    const { sender, params } = fakeSender({ encodings: [{}] }, "audio");
    await expect(applyAudioPriority(sender)).resolves.toBe(true);
    expect(params.encodings).toEqual([{ networkPriority: "high", priority: "high" }]);
  });

  it("creates an audio encoding when the browser has not supplied one", async () => {
    const { sender, params } = fakeSender({}, "audio");
    await expect(applyAudioPriority(sender)).resolves.toBe(true);
    expect(params.encodings).toEqual([{ networkPriority: "high", priority: "high" }]);
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
      leashSenders([first.sender, refused.sender, audio.sender, last.sender], "lean"),
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
    await expect(leashSenders([first.sender, second.sender], "full")).resolves.toBe(2);
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
    await expect(leashSenders([audio.sender, missing.sender], "lean")).resolves.toBe(0);
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
    await expect(applyLeash(picky.sender, CONSTRAINED_FULL_VIDEO)).resolves.toBe(true);
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
