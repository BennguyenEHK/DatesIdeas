import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Reel } from "./Reel";
import { buildReel } from "@/lib/album/timeline";
import type { AlbumItem, Gear, Occasion } from "@/lib/album/types";

// jsdom has no layout, so scrollIntoView is not implemented on elements. The
// component calls it whenever the selection moves; without this every keyboard
// test would fail on a missing method rather than on its own behaviour.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

function item(id: string, happenedAt: string, loved = false): AlbumItem {
  return {
    id,
    kind: "photo",
    contentType: "image/jpeg",
    bytes: 1,
    happenedAt,
    createdAt: happenedAt,
    caption: null,
    loved,
    sourceRoom: null,
    url: `https://example.test/${id}.jpg`,
    posterUrl: null,
  };
}

const ZONE = "UTC";

/** Three in February 2026, one in January, one in December 2025. */
const ITEMS = [
  item("e", "2026-02-05T12:00:00Z"),
  item("d", "2026-02-04T12:00:00Z", true),
  item("c", "2026-02-03T12:00:00Z"),
  item("b", "2026-01-20T12:00:00Z"),
  item("a", "2025-12-30T12:00:00Z"),
];

function renderReel(
  overrides: {
    current?: string | null;
    gear?: Gear;
    occasions?: Occasion[];
  } = {},
) {
  const onSelect = vi.fn();
  const onGear = vi.fn();
  const gear = overrides.gear ?? "frames";
  const view = buildReel(ITEMS, overrides.occasions ?? [], gear, ZONE);
  render(
    <Reel
      view={view}
      currentItemId={overrides.current === undefined ? "e" : overrides.current}
      gear={gear}
      onSelect={onSelect}
      onGear={onGear}
    />,
  );
  return { onSelect, onGear, track: screen.getByRole("listbox") };
}

describe("Reel", () => {
  it("names every frame by its date and what it is, not by its position", () => {
    // A screen reader travelling the strip is doing what an eye does: looking
    // for a day. "Frame 41 of 380" would be true and useless.
    renderReel();
    expect(screen.getByRole("option", { name: "2026-02-05, photo" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "2025-12-30, photo" })).toBeTruthy();
  });

  it("says how many memories a grouped frame stands for", () => {
    renderReel({ gear: "months" });
    expect(screen.getByRole("option", { name: "2026-02-01, 3 memories" })).toBeTruthy();
  });

  it("selects the frame that was clicked", () => {
    const { onSelect } = renderReel();
    fireEvent.click(screen.getByRole("option", { name: "2026-01-20, photo" }));
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("steps one memory with an arrow key", () => {
    const { onSelect, track } = renderReel({ current: "e" });
    fireEvent.keyDown(track, { key: "ArrowRight" });
    expect(onSelect).toHaveBeenCalledWith("d");
  });

  it("travels ten at a time with shift, so a year is not four hundred key presses", () => {
    const { onSelect, track } = renderReel({ current: "e" });
    fireEvent.keyDown(track, { key: "ArrowRight", shiftKey: true });
    // Ten runs off the end of a five-frame reel, so it must clamp to the last
    // frame rather than call back with nothing.
    expect(onSelect).toHaveBeenCalledWith("a");
  });

  it("does not step past either end", () => {
    const { onSelect, track } = renderReel({ current: "e" });
    fireEvent.keyDown(track, { key: "ArrowLeft" });
    expect(onSelect).toHaveBeenCalledWith("e");
  });

  it("jumps to the far end with Home and End", () => {
    const { onSelect, track } = renderReel({ current: "c" });
    fireEvent.keyDown(track, { key: "End" });
    expect(onSelect).toHaveBeenCalledWith("a");
    fireEvent.keyDown(track, { key: "Home" });
    expect(onSelect).toHaveBeenCalledWith("e");
  });

  it("changes gear with plus and minus", () => {
    const { onGear, track } = renderReel({ gear: "days" });
    // "+" means see more of the year, the way it does on a map rather than on
    // a microscope.
    fireEvent.keyDown(track, { key: "+" });
    expect(onGear).toHaveBeenCalledWith("months");
    fireEvent.keyDown(track, { key: "-" });
    expect(onGear).toHaveBeenCalledWith("frames");
  });

  it("does not call back when a gear change would run off the end", () => {
    const { onGear, track } = renderReel({ gear: "frames" });
    fireEvent.keyDown(track, { key: "-" });
    expect(onGear).not.toHaveBeenCalled();
  });

  it("changes gear from the buttons too", () => {
    const { onGear } = renderReel({ gear: "frames" });
    fireEvent.click(screen.getByRole("button", { name: "months" }));
    expect(onGear).toHaveBeenCalledWith("months");
  });

  it("marks a loved frame so the strip can light it", () => {
    renderReel();
    expect(
      screen.getByRole("option", { name: "2026-02-04, photo" }).getAttribute("data-loved"),
    ).toBe("true");
    expect(
      screen.getByRole("option", { name: "2026-02-03, photo" }).getAttribute("data-loved"),
    ).toBe("false");
  });

  it("lights a grouped frame when any memory inside it is loved", () => {
    // The loved photograph is one of three in February. It must not be hidden
    // by the two ordinary ones beside it.
    renderReel({ gear: "months" });
    expect(
      screen.getByRole("option", { name: "2026-02-01, 3 memories" }).getAttribute("data-loved"),
    ).toBe("true");
  });

  it("hangs an occasion sign on the day it belongs to", () => {
    renderReel({
      occasions: [
        { id: "o1", title: "Anniversary", onDate: "2026-02-04", yearly: false, coverItemId: null },
      ],
    });
    expect(screen.getByTitle("Anniversary")).toBeTruthy();
  });

  it("splices leader tape at each month boundary", () => {
    renderReel();
    expect(screen.getByText("February 2026")).toBeTruthy();
    expect(screen.getByText("December 2025")).toBeTruthy();
  });

  it("draws nothing and does not crash on an empty reel", () => {
    render(
      <Reel
        view={{ frames: [], tapes: [], marks: [] }}
        currentItemId={null}
        gear="frames"
        onSelect={vi.fn()}
        onGear={vi.fn()}
      />,
    );
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });
});
