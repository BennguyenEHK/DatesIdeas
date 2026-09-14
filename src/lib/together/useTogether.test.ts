import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PeerMessage } from "@/lib/rtc/protocol";
import { useTogether } from "./useTogether";

function setup() {
  const sent: PeerMessage[] = [];
  const send = vi.fn((message: PeerMessage) => void sent.push(message));
  const hook = renderHook(() => useTogether({ send }));
  return { hook, sent };
}

describe("useTogether", () => {
  it("shows a photograph here and tells the other screen", () => {
    const { hook, sent } = setup();
    act(() => hook.result.current.showAlbum({ itemId: "item-1", gear: "days" }));
    expect(hook.result.current.albumView).toEqual({ itemId: "item-1", gear: "days" });
    expect(sent).toEqual([{ t: "album-view", itemId: "item-1", gear: "days" }]);
  });

  it("follows the other screen without sending it back", () => {
    const { hook, sent } = setup();
    act(() => hook.result.current.accept({ t: "album-view", itemId: "item-2", gear: "months" }));
    act(() => hook.result.current.accept({ t: "calendar-week", start: "2026-09-07T05:00:00.000Z" }));
    expect(hook.result.current.albumView).toEqual({ itemId: "item-2", gear: "months" });
    expect(hook.result.current.calendarWeek).toBe("2026-09-07T05:00:00.000Z");
    expect(sent).toEqual([]);
  });

  it("counts change notices from the other screen, and not its own", () => {
    const { hook, sent } = setup();
    act(() => hook.result.current.albumChanged());
    act(() => hook.result.current.calendarChanged());
    expect(hook.result.current.albumRevision).toBe(0);
    expect(hook.result.current.calendarRevision).toBe(0);
    expect(sent).toEqual([{ t: "album-changed" }, { t: "calendar-changed" }]);

    act(() => hook.result.current.accept({ t: "album-changed" }));
    act(() => hook.result.current.accept({ t: "calendar-changed" }));
    act(() => hook.result.current.accept({ t: "calendar-changed" }));
    expect(hook.result.current.albumRevision).toBe(1);
    expect(hook.result.current.calendarRevision).toBe(2);
  });

  it("tells a rejoining screen where both views are", () => {
    const { hook, sent } = setup();
    act(() => hook.result.current.showAlbum({ itemId: "item-3", gear: "frames" }));
    act(() => hook.result.current.showWeek("2026-09-14T05:00:00.000Z"));
    sent.length = 0;
    act(() => hook.result.current.resync());
    expect(sent).toEqual([
      { t: "album-view", itemId: "item-3", gear: "frames" },
      { t: "calendar-week", start: "2026-09-14T05:00:00.000Z" },
    ]);
  });

  it("ignores messages that are not about the album or the calendar", () => {
    const { hook } = setup();
    act(() => hook.result.current.accept({ t: "canvas-base", itemId: "x" }));
    expect(hook.result.current.albumView).toEqual({ itemId: null, gear: "frames" });
  });
});
