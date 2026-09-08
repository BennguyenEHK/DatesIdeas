import { afterEach, describe, expect, it, vi } from "vitest";

import {
  boostMic,
  COMPRESSOR_ATTACK_S,
  COMPRESSOR_KNEE_DB,
  COMPRESSOR_RATIO,
  COMPRESSOR_RELEASE_S,
  COMPRESSOR_THRESHOLD_DB,
  dbToGain,
  MAKEUP_GAIN_DB,
  type AudioContextLike,
} from "./micGain";

interface FakeNode {
  connect: ReturnType<typeof vi.fn<(destination: object) => unknown>>;
  disconnect: ReturnType<typeof vi.fn<() => unknown>>;
}

function node(): FakeNode {
  return {
    connect: vi.fn<(destination: object) => unknown>(),
    disconnect: vi.fn<() => unknown>(),
  };
}

function context(destinationTracks: MediaStreamTrack[]): {
  context: AudioContextLike;
  source: FakeNode;
  compressor: FakeNode & {
    threshold: { value: number };
    knee: { value: number };
    ratio: { value: number };
    attack: { value: number };
    release: { value: number };
  };
  gain: FakeNode & { gain: { value: number } };
  destination: { stream: MediaStream };
  close: ReturnType<typeof vi.fn>;
} {
  const source = node();
  const compressor = {
    ...node(),
    threshold: { value: 0 },
    knee: { value: 0 },
    ratio: { value: 0 },
    attack: { value: 0 },
    release: { value: 0 },
  };
  const gain = { ...node(), gain: { value: 0 } };
  const close = vi.fn<() => Promise<void>>().mockResolvedValue();
  const stream = { getAudioTracks: () => destinationTracks } as MediaStream;
  const destination = { stream };

  return {
    context: {
      createMediaStreamSource: vi.fn(() => source),
      createDynamicsCompressor: vi.fn(() => compressor),
      createGain: vi.fn(() => gain),
      createMediaStreamDestination: vi.fn(() => destination),
      close,
    },
    source,
    compressor,
    gain,
    destination,
    close,
  };
}

const sourceTrack = { stop: vi.fn() } as unknown as MediaStreamTrack;

afterEach(() => vi.unstubAllGlobals());

describe("dbToGain", () => {
  it("converts decibels into the linear scale Web Audio expects", () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(10)).toBeCloseTo(3.162, 3);
    expect(dbToGain(-6)).toBeCloseTo(0.501, 3);
  });
});

describe("boostMic", () => {
  it("keeps the raw microphone when Web Audio is unavailable", () => {
    vi.stubGlobal("AudioContext", undefined);

    expect(boostMic(sourceTrack)).toBeNull();
  });

  it("keeps the raw microphone when the context constructor refuses to open", () => {
    vi.stubGlobal("AudioContext", class {
      constructor() { throw new Error("blocked"); }
    });

    expect(boostMic(sourceTrack)).toBeNull();
  });

  it("keeps the raw microphone when the destination cannot provide audio", () => {
    vi.stubGlobal("MediaStream", class {});
    const fake = context([]);

    expect(boostMic(sourceTrack, () => fake.context)).toBeNull();
    expect(fake.close).toHaveBeenCalledOnce();
  });

  it("wires the microphone through compression and makeup gain in order", () => {
    vi.stubGlobal("MediaStream", class {});
    const processedTrack = {} as MediaStreamTrack;
    const fake = context([processedTrack]);

    const boosted = boostMic(sourceTrack, () => fake.context);

    expect(boosted?.track).toBe(processedTrack);
    expect(fake.source.connect).toHaveBeenCalledWith(fake.compressor);
    expect(fake.compressor.connect).toHaveBeenCalledWith(fake.gain);
    expect(fake.gain.connect).toHaveBeenCalledWith(fake.destination);
    expect(fake.source.connect.mock.invocationCallOrder[0]).toBeLessThan(
      fake.compressor.connect.mock.invocationCallOrder[0],
    );
    expect(fake.compressor.connect.mock.invocationCallOrder[0]).toBeLessThan(
      fake.gain.connect.mock.invocationCallOrder[0],
    );
  });

  it("places each tuning constant on the node parameter it protects", () => {
    vi.stubGlobal("MediaStream", class {});
    const fake = context([{} as MediaStreamTrack]);

    boostMic(sourceTrack, () => fake.context);

    expect(fake.compressor.threshold.value).toBe(COMPRESSOR_THRESHOLD_DB);
    expect(fake.compressor.knee.value).toBe(COMPRESSOR_KNEE_DB);
    expect(fake.compressor.ratio.value).toBe(COMPRESSOR_RATIO);
    expect(fake.compressor.attack.value).toBe(COMPRESSOR_ATTACK_S);
    expect(fake.compressor.release.value).toBe(COMPRESSOR_RELEASE_S);
    expect(fake.gain.gain.value).toBeCloseTo(dbToGain(MAKEUP_GAIN_DB));
  });

  it("releases the graph only once without stopping the caller's source track", () => {
    vi.stubGlobal("MediaStream", class {});
    const fake = context([{} as MediaStreamTrack]);
    const boosted = boostMic(sourceTrack, () => fake.context);

    boosted?.close();
    boosted?.close();

    expect(fake.source.disconnect).toHaveBeenCalledOnce();
    expect(fake.compressor.disconnect).toHaveBeenCalledOnce();
    expect(fake.gain.disconnect).toHaveBeenCalledOnce();
    expect(fake.close).toHaveBeenCalledOnce();
    expect(sourceTrack.stop).not.toHaveBeenCalled();
  });

  it("survives a context that rejects while closing", async () => {
    vi.stubGlobal("MediaStream", class {});
    const fake = context([{} as MediaStreamTrack]);
    fake.close.mockRejectedValueOnce(new Error("already closed"));
    const boosted = boostMic(sourceTrack, () => fake.context);

    expect(() => boosted?.close()).not.toThrow();
    await Promise.resolve();
  });

  it("wakes a context that a browser started suspended", () => {
    // A suspended graph still hands back a valid track -- one carrying silence
    // -- and that track is about to replace a working microphone on a call.
    vi.stubGlobal("MediaStream", class {});
    const resume = vi.fn<() => Promise<void>>().mockResolvedValue();
    const fake = context([{} as MediaStreamTrack]);

    boostMic(sourceTrack, () => ({ ...fake.context, state: "suspended", resume }));

    expect(resume).toHaveBeenCalledOnce();
  });

  it("still returns a boosted microphone when resume is refused", () => {
    vi.stubGlobal("MediaStream", class {});
    const resume = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error("blocked"));
    const fake = context([{} as MediaStreamTrack]);

    const boosted = boostMic(sourceTrack, () => ({
      ...fake.context,
      state: "suspended",
      resume,
    }));

    expect(boosted).not.toBeNull();
  });

  it("leaves a running context alone", () => {
    vi.stubGlobal("MediaStream", class {});
    const resume = vi.fn<() => Promise<void>>().mockResolvedValue();
    const fake = context([{} as MediaStreamTrack]);

    boostMic(sourceTrack, () => ({ ...fake.context, state: "running", resume }));

    expect(resume).not.toHaveBeenCalled();
  });
});
