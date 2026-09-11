import { describe, expect, it } from "vitest";
import { buildReel, frameIndexFor } from "./timeline";
import type { AlbumItem, Occasion } from "./types";

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
    url: "https://example.test/photo.jpg",
    posterUrl: null,
  };
}

function occasion(id: string, onDate: string, yearly = false): Occasion {
  return { id, title: id, onDate, yearly, coverItemId: null };
}

describe("album reel", () => {
  const zone = "America/Los_Angeles";
  const items = [
    item("c", "2026-02-02T19:00:00Z"),
    item("a", "2026-02-02T18:00:00Z", true),
    item("b", "2026-02-02T18:00:00Z"),
    item("d", "2026-01-03T08:00:00Z"),
    item("e", "2025-12-31T23:00:00Z"),
  ];

  it("sorts frames by instant with an id tie-breaker", () => {
    const view = buildReel(items, [], "frames", zone);

    expect(view.frames.map((frame) => frame.item.id)).toEqual(["c", "a", "b", "d", "e"]);
    expect(view.frames.map((frame) => frame.key)).toEqual(["frame:c", "frame:a", "frame:b", "frame:d", "frame:e"]);
  });

  it("groups by viewer-zone day and preserves the newest representative and any loved item", () => {
    const view = buildReel(items, [], "days", zone);

    expect(view.frames.map((frame) => [frame.date, frame.item.id, frame.count, frame.loved])).toEqual([
      ["2026-02-02", "c", 3, true],
      ["2026-01-03", "d", 1, false],
      ["2025-12-31", "e", 1, false],
    ]);
    expect(view.frames[0].items.map((grouped) => grouped.id)).toEqual(["c", "a", "b"]);
  });

  it("groups months, puts their date on the first, and inserts only yearly tapes", () => {
    const view = buildReel(items, [], "months", zone);

    expect(view.frames.map((frame) => [frame.key, frame.date, frame.count])).toEqual([
      ["months:2026-02", "2026-02-01", 3],
      ["months:2026-01", "2026-01-01", 1],
      ["months:2025-12", "2025-12-01", 1],
    ]);
    expect(view.tapes).toEqual([
      { beforeIndex: 0, label: "2026", month: "2026-02" },
      { beforeIndex: 2, label: "2025", month: "2025-12" },
    ]);
  });

  it("adds month tapes at each boundary, including the first frame", () => {
    const view = buildReel(items, [], "days", zone);

    expect(view.tapes).toEqual([
      { beforeIndex: 0, label: "February 2026", month: "2026-02" },
      { beforeIndex: 1, label: "January 2026", month: "2026-01" },
      { beforeIndex: 2, label: "December 2025", month: "2025-12" },
    ]);
  });

  it("places ordinary and yearly occasions, including leap-day fallback, on matching frames", () => {
    const leapItems = [
      item("new", "2026-02-28T20:00:00Z"),
      item("old", "2024-02-29T20:00:00Z"),
      item("june", "2025-06-01T20:00:00Z"),
    ];
    const view = buildReel(leapItems, [occasion("leap", "2024-02-29", true), occasion("trip", "2025-06-01")], "days", zone);

    expect(view.marks.map((mark) => [mark.occasion.id, mark.date, mark.frameIndex, mark.lit])).toEqual([
      ["leap", "2026-02-28", 0, true],
      ["trip", "2025-06-01", 1, true],
      ["leap", "2025-02-28", -1, false],
      ["leap", "2024-02-29", 2, true],
    ]);
  });

  it("matches occasion signs to a whole month in months gear", () => {
    const view = buildReel([item("feb", "2026-02-02T20:00:00Z")], [occasion("date", "2026-02-14")], "months", zone);

    expect(view.marks).toEqual([
      expect.objectContaining({ date: "2026-02-14", frameIndex: 0, lit: true }),
    ]);
  });

  it("keeps an item's centre findable after grouping and returns -1 when absent", () => {
    const view = buildReel(items, [], "days", zone);

    expect(frameIndexFor(view, "a")).toBe(0);
    expect(frameIndexFor(view, "missing")).toBe(-1);
  });

  it("returns no derived reel data when there are no items", () => {
    expect(buildReel([], [occasion("leap", "2024-02-29", true)], "frames", zone)).toEqual({
      frames: [],
      tapes: [],
      marks: [],
    });
  });
});
