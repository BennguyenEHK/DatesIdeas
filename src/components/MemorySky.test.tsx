import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemorySky } from "./MemorySky";
import type { AlbumItem } from "@/lib/album/types";

const items = ["one", "two", "three"].map((id, index) => ({
  id,
  kind: "photo",
  contentType: "image/jpeg",
  bytes: 1,
  happenedAt: `2026-02-0${index + 1}T12:00:00Z`,
  createdAt: `2026-02-0${index + 1}T12:00:00Z`,
  caption: `${id} caption`,
  loved: false,
  sourceRoom: null,
  url: `https://example.test/${id}.jpg`,
  posterUrl: null,
})) satisfies AlbumItem[];

afterEach(cleanup);

describe("MemorySky", () => {
  it("shows the selected caption and lets arrows and keys select neighbours", () => {
    const onSelect = vi.fn();
    render(<MemorySky items={items} selectedId="two" onSelect={onSelect} />);
    expect(screen.getByText("two caption")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next memory" }));
    fireEvent.keyDown(screen.getByRole("region", { name: "Memory sky" }), { key: "ArrowLeft" });
    expect(onSelect).toHaveBeenNthCalledWith(1, "three");
    expect(onSelect).toHaveBeenNthCalledWith(2, "one");
  });

  it("selects a neighbouring lantern and never advances by itself", () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    render(<MemorySky items={items} selectedId="two" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Show February 1, 2026" }));
    vi.runAllTimers();
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith("one");
    vi.useRealTimers();
  });
});
