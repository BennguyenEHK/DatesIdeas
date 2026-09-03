import { describe, expect, it, vi } from "vitest";
import {
  applyLeash,
  FULL_VIDEO,
  leashFor,
  leashSenders,
  LEAN_VIDEO,
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
      { maxBitrate: 500_000, scaleResolutionDownBy: 2, maxFramerate: 24 },
    ]);
  });

  it("creates an encoding when the array is empty", async () => {
    const { sender, params } = fakeSender({ encodings: [] });
    await applyLeash(sender, FULL_VIDEO);
    expect(params.encodings).toEqual([
      { maxBitrate: 2_500_000, scaleResolutionDownBy: 1, maxFramerate: 30 },
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
      { rid: "low", maxBitrate: 500_000, scaleResolutionDownBy: 2, maxFramerate: 24 },
      { rid: "high", maxBitrate: 500_000, scaleResolutionDownBy: 2, maxFramerate: 24 },
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
    expect(refused.setParameters).toHaveBeenCalledOnce();
    expect(last.setParameters).toHaveBeenCalledOnce();
  });

  it("applies the full budget to every eligible sender", async () => {
    const first = fakeSender({ encodings: [{}] });
    const second = fakeSender({ encodings: [{}] });
    await expect(leashSenders([first.sender, second.sender], "full")).resolves.toBe(2);
    expect(first.params.encodings?.[0]?.maxBitrate).toBe(2_500_000);
    expect(second.params.encodings?.[0]?.maxFramerate).toBe(30);
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
