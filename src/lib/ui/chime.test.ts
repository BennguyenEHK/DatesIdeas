import { describe, expect, it, vi } from "vitest";
import { playChime, type ChimeContextLike } from "./chime";

function fakeContext() {
  const oscillators: Array<{
    type: string;
    frequency: { setValueAtTime: ReturnType<typeof vi.fn> };
    connect: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  }> = [];
  const gain = {
    gain: {
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
  };
  const context: ChimeContextLike = {
    currentTime: 10,
    destination: {},
    createGain: () => gain,
    createOscillator: () => {
      const oscillator = {
        type: "",
        frequency: { setValueAtTime: vi.fn() },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      oscillators.push(oscillator);
      return oscillator;
    },
  };
  return { context, gain, oscillators };
}

describe("playChime", () => {
  it("makes the sent whisper from two quiet sine tones, then lets it disappear", () => {
    const { context, gain, oscillators } = fakeContext();
    playChime(context, "sent");

    expect(oscillators.map(({ type }) => type)).toEqual(["sine", "sine"]);
    expect(oscillators.map(({ frequency }) => frequency.setValueAtTime.mock.calls[0][0])).toEqual([
      392,
      587.33,
    ]);
    expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.06, 10.04);
    expect(gain.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.0001, 10.54);
    expect(oscillators.map(({ stop }) => stop.mock.calls[0][0])).toEqual([10.6, 10.6]);
  });

  it("keeps the received voice related but lifts it an octave for attention", () => {
    const { context, oscillators } = fakeContext();
    playChime(context, "received");
    expect(oscillators.map(({ frequency }) => frequency.setValueAtTime.mock.calls[0][0])).toEqual([
      523.25,
      783.99,
    ]);
  });

  it("leaves the chat alone when a browser declines to make sound", () => {
    const silent: ChimeContextLike = {
      currentTime: 0,
      destination: {},
      createGain: () => {
        throw new Error("not allowed");
      },
      createOscillator: () => {
        throw new Error("not allowed");
      },
    };
    expect(() => playChime(silent, "received")).not.toThrow();
  });
});
