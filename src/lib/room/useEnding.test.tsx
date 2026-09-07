import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useEnding } from "./useEnding";
import { NOTICE_MS, TV_OFF_MS, DARK_HOLD_MS } from "./ending";
import type { PeerMessage } from "@/lib/rtc/protocol";

function setup(start = 1_700_000_000_000) {
  const sent: PeerMessage[] = [];
  const finished = vi.fn();
  let shared = start;
  const view = renderHook(() =>
    useEnding({
      now: () => shared,
      send: (m) => sent.push(m),
      onFinished: finished,
    }),
  );
  return {
    view,
    sent,
    finished,
    /** Advances both the shared clock and the timers, as time really does. */
    pass: async (ms: number) => {
      shared += ms;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useEnding", () => {
  it("does nothing until somebody calls the end", () => {
    const t = setup();
    expect(t.view.result.current.phase).toBe("none");
    expect(t.view.result.current.endsInMs).toBeNull();
  });

  it("gives a few more seconds, and tells the other side when they run out", () => {
    // Shared rather than private: one screen going dark on its own would leave
    // the other person alone in a room with no explanation.
    const t = setup(1_700_000_000_000);
    act(() => t.view.result.current.end());

    expect(t.view.result.current.phase).toBe("counting");
    expect(t.view.result.current.endsInMs).toBe(NOTICE_MS);
    expect(t.sent).toEqual([
      { t: "ending", endsAt: 1_700_000_000_000 + NOTICE_MS },
    ]);
  });

  it("counts down against the shared clock", async () => {
    const t = setup();
    act(() => t.view.result.current.end());
    // Comfortably inside the notice, so this measures the countdown rather
    // than the floor it stops at.
    await t.pass(2_000);
    expect(t.view.result.current.endsInMs).toBe(NOTICE_MS - 2_000);
  });

  it("can be called off, and says so", () => {
    const t = setup();
    act(() => t.view.result.current.end());
    t.sent.length = 0;
    act(() => t.view.result.current.stay());

    expect(t.view.result.current.phase).toBe("none");
    expect(t.view.result.current.endsInMs).toBeNull();
    expect(t.sent).toEqual([{ t: "ending", endsAt: null }]);
  });

  it("adopts an ending the other person called, without echoing it back", () => {
    // An echo would be answered with an echo. Two peers agreeing loudly is how
    // a message loop starts, and this one would run for five minutes.
    const t = setup(1_700_000_000_000);
    act(() =>
      t.view.result.current.accept({
        t: "ending",
        endsAt: 1_700_000_000_000 + 120_000,
      }),
    );

    expect(t.view.result.current.phase).toBe("counting");
    expect(t.view.result.current.endsInMs).toBe(120_000);
    expect(t.sent).toEqual([]);
  });

  it("lets the other person call it off too", () => {
    const t = setup();
    act(() => t.view.result.current.end());
    act(() => t.view.result.current.accept({ t: "ending", endsAt: null }));
    expect(t.view.result.current.phase).toBe("none");
  });

  it("ignores messages that are not about the ending", () => {
    const t = setup();
    act(() => t.view.result.current.accept({ t: "singing", on: true }));
    expect(t.view.result.current.phase).toBe("none");
  });

  it("THE SEQUENCE: counts down, closes the picture, goes dark, then leaves", async () => {
    const t = setup();
    act(() => t.view.result.current.end());

    await t.pass(NOTICE_MS);
    expect(t.view.result.current.phase).toBe("closing");
    expect(t.finished).not.toHaveBeenCalled();

    await t.pass(TV_OFF_MS);
    expect(t.view.result.current.phase).toBe("dark");
    expect(t.finished).not.toHaveBeenCalled();

    await t.pass(DARK_HOLD_MS);
    expect(t.finished).toHaveBeenCalledTimes(1);
  });

  it("leaves once and then stays left, however long it is given", async () => {
    // Each step of the sequence schedules the next, so they are walked rather
    // than jumped: a single leap forward is a thing only a backgrounded tab
    // does, and it would still chain there, merely late.
    const t = setup();
    act(() => t.view.result.current.end());
    await t.pass(NOTICE_MS);
    await t.pass(TV_OFF_MS);
    await t.pass(DARK_HOLD_MS);
    expect(t.finished).toHaveBeenCalledTimes(1);

    await t.pass(60_000);
    expect(t.finished).toHaveBeenCalledTimes(1);
    expect(t.view.result.current.phase).toBe("dark");
  });

  it("cannot be talked out of it once the picture is going", async () => {
    // A cancel arriving a half-second late is the ordinary case for two people
    // on a relayed connection, and reviving one screen but not the other is
    // worse than ending a moment early.
    const t = setup();
    act(() => t.view.result.current.end());
    await t.pass(NOTICE_MS);
    expect(t.view.result.current.phase).toBe("closing");

    act(() => t.view.result.current.accept({ t: "ending", endsAt: null }));
    expect(t.view.result.current.phase).toBe("closing");
  });

  it("stops counting the moment the picture starts, so nothing shows a negative", async () => {
    const t = setup();
    act(() => t.view.result.current.end());
    await t.pass(NOTICE_MS + 5_000);
    expect(t.view.result.current.endsInMs).toBeNull();
  });
});
