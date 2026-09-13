import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildVoiceChain,
  type VoiceContextLike,
} from "./voiceChain";
import {
  VOICE_PROCESSOR_NAME,
  VOICE_STYLES,
  VOICE_WORKLET_URL,
} from "./voiceStyles";

function node() {
  return { connect: vi.fn(), disconnect: vi.fn() };
}
function fakeContext(output: MediaStreamTrack[]) {
  const source = node();
  const filters = [node(), node()].map((item) => ({
    ...item,
    type: "",
    frequency: { value: 0 },
    Q: { value: 0 },
    gain: { value: 0 },
  }));
  const destination = {
    stream: { getAudioTracks: () => output } as MediaStream,
  };
  const close = vi.fn(() => Promise.resolve());
  const addModule = vi.fn(() => Promise.resolve());
  return {
    source,
    filters,
    destination,
    close,
    addModule,
    context: {
      createMediaStreamSource: vi.fn(() => source),
      createBiquadFilter: vi.fn(() => filters.shift()!),
      createMediaStreamDestination: vi.fn(() => destination),
      audioWorklet: { addModule },
      close,
    } as unknown as VoiceContextLike,
  };
}
const input = { stop: vi.fn() } as unknown as MediaStreamTrack;
afterEach(() => vi.unstubAllGlobals());

describe("buildVoiceChain", () => {
  it("orders clean filters and dynamics with their specified parameters", async () => {
    vi.stubGlobal("MediaStream", class {});
    const fake = fakeContext([{} as MediaStreamTrack]);
    const worklet = node();
    const makeWorkletNode = vi.fn(() => worklet);
    const result = await buildVoiceChain(input, "clean", {
      makeContext: () => fake.context,
      makeWorkletNode,
    });
    expect(result?.dynamics).toBe(true);
    expect(fake.filters[0]?.type).toBeUndefined();
    expect(fake.context.createBiquadFilter).toHaveBeenCalledTimes(2);
    const made = (
      fake.context.createBiquadFilter as ReturnType<typeof vi.fn>
    ).mock.results.map((entry) => entry.value);
    expect(made[0]).toMatchObject({
      type: "highpass",
      frequency: { value: 90 },
      Q: { value: 0.7071 },
    });
    expect(made[1]).toMatchObject({
      type: "peaking",
      frequency: { value: 3000 },
      Q: { value: 0.9 },
      gain: { value: 3 },
    });
    expect(fake.source.connect).toHaveBeenCalledWith(made[0]);
    expect(made[0].connect).toHaveBeenCalledWith(made[1]);
    expect(made[1].connect).toHaveBeenCalledWith(worklet);
    expect(worklet.connect).toHaveBeenCalledWith(fake.destination);
  });
  it("builds open as source, worklet, destination and passes its settings", async () => {
    vi.stubGlobal("MediaStream", class {});
    const fake = fakeContext([{} as MediaStreamTrack]);
    const worklet = node();
    const factory = vi.fn(() => worklet);
    await buildVoiceChain(input, "open", {
      makeContext: () => fake.context,
      makeWorkletNode: factory,
    });
    expect(fake.addModule).toHaveBeenCalledWith(VOICE_WORKLET_URL);
    expect(fake.source.connect).toHaveBeenCalledWith(worklet);
    expect(worklet.connect).toHaveBeenCalledWith(fake.destination);
    expect(factory).toHaveBeenCalledWith(
      fake.context,
      VOICE_PROCESSOR_NAME,
      expect.objectContaining({
        processorOptions: { settings: VOICE_STYLES.open.dynamics },
      }),
    );
  });
  it("falls back to clean filters without a gain node when the module rejects", async () => {
    vi.stubGlobal("MediaStream", class {});
    const fake = fakeContext([{} as MediaStreamTrack]);
    fake.addModule.mockRejectedValue(new Error("no worklet"));
    const result = await buildVoiceChain(input, "clean", {
      makeContext: () => fake.context,
    });
    expect(result?.dynamics).toBe(false);
    expect(fake.context.createBiquadFilter).toHaveBeenCalledTimes(2);
    expect(fake.source.connect).toHaveBeenCalledTimes(1);
  });
  it("returns raw fallback for open when the module rejects", async () => {
    vi.stubGlobal("MediaStream", class {});
    const fake = fakeContext([{} as MediaStreamTrack]);
    fake.addModule.mockRejectedValue(new Error("no worklet"));
    expect(
      await buildVoiceChain(input, "open", { makeContext: () => fake.context }),
    ).toBeNull();
    expect(fake.close).toHaveBeenCalledOnce();
  });
  it("returns null when no context is requested", async () => {
    expect(
      await buildVoiceChain(input, "open", { makeContext: null }),
    ).toBeNull();
  });
  it("closes once without stopping the captured source", async () => {
    vi.stubGlobal("MediaStream", class {});
    const fake = fakeContext([{} as MediaStreamTrack]);
    const result = await buildVoiceChain(input, "open", {
      makeContext: () => fake.context,
      makeWorkletNode: () => node(),
    });
    result?.close();
    result?.close();
    expect(fake.close).toHaveBeenCalledOnce();
    expect(input.stop).not.toHaveBeenCalled();
  });
  it("cleans up a graph that throws during construction", async () => {
    vi.stubGlobal("MediaStream", class {});
    const fake = fakeContext([{} as MediaStreamTrack]);
    (
      fake.context.createMediaStreamDestination as ReturnType<typeof vi.fn>
    ).mockImplementation(() => {
      throw new Error("broken");
    });
    expect(
      await buildVoiceChain(input, "clean", {
        makeContext: () => fake.context,
        makeWorkletNode: () => node(),
      }),
    ).toBeNull();
    expect(fake.close).toHaveBeenCalledOnce();
  });
});
