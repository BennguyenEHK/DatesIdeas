import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JOINED_NOTICE_MS, JoinedNotice } from "./JoinedNotice";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("JoinedNotice", () => {
  it("says a new device joined and Undo removes it", () => {
    const onUndo = vi.fn();
    render(<JoinedNotice onUndo={onUndo} onDismiss={vi.fn()} />);
    expect(screen.getByText("A new device joined your album")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Undo: remove that device from the album" }),
    );
    expect(onUndo).toHaveBeenCalledOnce();
  });

  it("can be dismissed", () => {
    const onDismiss = vi.fn();
    render(<JoinedNotice onUndo={vi.fn()} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("goes by itself after thirty seconds", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<JoinedNotice onUndo={vi.fn()} onDismiss={onDismiss} />);
    act(() => vi.advanceTimersByTime(JOINED_NOTICE_MS - 1));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
