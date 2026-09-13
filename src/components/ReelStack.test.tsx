import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReelStack } from "./ReelStack";
import type { AlbumItem, Frame } from "@/lib/album/types";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

function item(id: string): AlbumItem {
  return {
    id,
    kind: "photo",
    contentType: "image/jpeg",
    bytes: 1,
    happenedAt: "2026-02-05T12:00:00Z",
    createdAt: "2026-02-05T12:00:00Z",
    caption: null,
    loved: false,
    sourceRoom: null,
    url: `https://example.test/${id}.jpg`,
    posterUrl: null,
  };
}

function frame(count: number): Frame {
  const items = Array.from({ length: count }, (_, index) => item(`memory-${index + 1}`));
  return {
    key: "days:2026-02-05",
    item: items[0]!,
    items,
    count,
    loved: false,
    date: "2026-02-05",
  };
}

describe("ReelStack", () => {
  it("selects the top print and opens its fan into the document body", () => {
    const onSelect = vi.fn();
    render(<ReelStack frame={frame(3)} index={0} selected={false} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("option", { name: "2026-02-05, 3 memories" }));

    expect(onSelect).toHaveBeenCalledWith("memory-1");
    expect(document.body.querySelectorAll("[data-reel-fan-first]")).toHaveLength(1);
  });

  it("shows at most seven cards, and a print click selects that print and closes", () => {
    const onSelect = vi.fn();
    render(<ReelStack frame={frame(12)} index={0} selected={false} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("option"));
    expect(document.body.querySelectorAll("[data-reel-fan-first], [aria-label$='more memories']")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /2026-02-05/ })).toHaveLength(7);
    expect(screen.getByRole("button", { name: "2026-02-05, 6 more memories" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "2026-02-05, memory 2" }));
    expect(onSelect).toHaveBeenLastCalledWith("memory-2");
    expect(screen.queryByRole("button", { name: "2026-02-05, memory 2" })).toBeNull();
  });

  it("follows the reel's own scroll just after opening, and closes on a later one", () => {
    // Selecting a stack scrolls the reel to centre it. That scroll must not
    // snap the fan shut the moment it opens.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-12T20:00:00.000Z"));
    render(<ReelStack frame={frame(3)} index={0} selected={false} onSelect={vi.fn()} />);

    fireEvent.click(screen.getByRole("option"));
    act(() => void window.dispatchEvent(new Event("reel-stack-close")));
    expect(screen.getByRole("button", { name: "2026-02-05, memory 1" })).toBeTruthy();

    vi.setSystemTime(new Date("2026-09-12T20:00:05.000Z"));
    act(() => void window.dispatchEvent(new Event("reel-stack-close")));
    expect(screen.queryByRole("button", { name: "2026-02-05, memory 1" })).toBeNull();
    vi.useRealTimers();
  });

  it("opens from the keyboard, moves focus to the first print, and returns it on Escape", () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    render(<ReelStack frame={frame(3)} index={0} selected={false} onSelect={onSelect} />);
    const stack = screen.getByRole("option");

    stack.focus();
    fireEvent.keyDown(stack, { key: "Enter" });
    vi.runAllTimers();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "2026-02-05, memory 1" }));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "2026-02-05, memory 1" })).toBeNull();
    expect(document.activeElement).toBe(stack);
    vi.useRealTimers();
  });
});
