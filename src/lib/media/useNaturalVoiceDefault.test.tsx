import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useNaturalVoiceDefault } from "./useNaturalVoiceDefault";

describe("useNaturalVoiceDefault", () => {
  it("turns natural voice on once when karaoke opens", () => {
    const turnOn = vi.fn();
    const { rerender } = renderHook(
      ({ karaoke }) => useNaturalVoiceDefault(karaoke, turnOn),
      { initialProps: { karaoke: false } },
    );
    expect(turnOn).not.toHaveBeenCalled();

    rerender({ karaoke: true });
    rerender({ karaoke: true });
    expect(turnOn).toHaveBeenCalledOnce();
  });

  it("leaves a switch someone turned off alone for the rest of that karaoke", () => {
    // The default is a starting point, not a rule: turning it off must stick,
    // and a refused echo canceller must not be retried in a loop.
    const turnOn = vi.fn();
    const { rerender } = renderHook(
      ({ karaoke, cb }) => useNaturalVoiceDefault(karaoke, cb),
      { initialProps: { karaoke: true, cb: turnOn } },
    );
    rerender({ karaoke: true, cb: vi.fn() });
    expect(turnOn).toHaveBeenCalledOnce();
  });

  it("turns it on again the next time karaoke opens", () => {
    const turnOn = vi.fn();
    const { rerender } = renderHook(
      ({ karaoke }) => useNaturalVoiceDefault(karaoke, turnOn),
      { initialProps: { karaoke: true } },
    );
    rerender({ karaoke: false });
    rerender({ karaoke: true });
    expect(turnOn).toHaveBeenCalledTimes(2);
  });
});
