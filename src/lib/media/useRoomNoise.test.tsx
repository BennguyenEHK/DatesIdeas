import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ROOM_WINDOW_SAMPLES } from "./roomNoise";
import { useRoomNoise } from "./useRoomNoise";

const noisySamples = Array<number>(ROOM_WINDOW_SAMPLES).fill(0.04);
const quietSamples = [
  ...Array<number>(40).fill(0.005),
  ...Array<number>(10).fill(0.2),
];

const observeAll = (observe: (rms: number) => void, samples: readonly number[]) => {
  act(() => samples.forEach(observe));
};

describe("useRoomNoise", () => {
  it("latches a noisy window for the karaoke session", () => {
    const { result } = renderHook(() => useRoomNoise({ active: true, listening: true }));
    observeAll(result.current.observe, noisySamples);
    expect(result.current.noisy).toBe(true);
    expect(result.current.reading?.verdict).toBe("noisy");
  });

  it("reports a quiet window without turning suppression on", () => {
    const { result } = renderHook(() => useRoomNoise({ active: true, listening: true }));
    observeAll(result.current.observe, quietSamples);
    expect(result.current.noisy).toBe(false);
    expect(result.current.reading?.verdict).toBe("quiet");
  });

  it("ignores unsafe samples and discards a partial window at the song boundary", () => {
    const { result, rerender } = renderHook(
      ({ listening }) => useRoomNoise({ active: true, listening }),
      { initialProps: { listening: true } },
    );

    observeAll(result.current.observe, noisySamples.slice(0, 49));
    rerender({ listening: false });
    observeAll(result.current.observe, noisySamples);
    rerender({ listening: true });
    observeAll(result.current.observe, noisySamples.slice(0, 1));
    expect(result.current.reading).toBeNull();
    expect(result.current.noisy).toBe(false);
  });

  it("stops taking samples after a noisy verdict", () => {
    const { result } = renderHook(() => useRoomNoise({ active: true, listening: true }));
    observeAll(result.current.observe, noisySamples);
    const firstReading = result.current.reading;
    observeAll(result.current.observe, quietSamples);
    expect(result.current.noisy).toBe(true);
    expect(result.current.reading).toBe(firstReading);
  });

  it("resets on close and judges the next karaoke session afresh", async () => {
    const { result, rerender } = renderHook(
      ({ active }) => useRoomNoise({ active, listening: true }),
      { initialProps: { active: true } },
    );

    observeAll(result.current.observe, noisySamples);
    rerender({ active: false });
    await act(async () => {});
    expect(result.current).toMatchObject({ noisy: false, reading: null });

    rerender({ active: true });
    observeAll(result.current.observe, quietSamples);
    expect(result.current.noisy).toBe(false);
    expect(result.current.reading?.verdict).toBe("quiet");
  });

  it("keeps observe stable across rerenders", () => {
    const { result, rerender } = renderHook(
      ({ listening }) => useRoomNoise({ active: true, listening }),
      { initialProps: { listening: true } },
    );
    const observe = result.current.observe;
    rerender({ listening: false });
    expect(result.current.observe).toBe(observe);
  });
});
