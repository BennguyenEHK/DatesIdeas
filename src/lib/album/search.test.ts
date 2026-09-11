import { describe, expect, it } from "vitest";
import { searchItems } from "./search";
import type { AlbumItem, Occasion } from "./types";

const item = (id: string, happenedAt: string, caption: string | null): AlbumItem => ({
  id, happenedAt, caption, kind: "photo", contentType: "image/jpeg", bytes: 1,
  createdAt: happenedAt, loved: false, sourceRoom: null, url: "/photo", posterUrl: null,
});
const items = [item("one", "2026-02-14T02:00:00Z", "Dancing together"), item("two", "2026-05-01T02:00:00Z", null)];
const occasions: Occasion[] = [{ id: "birthday", title: "Mia's birthday", onDate: "2026-02-13", yearly: false, coverItemId: null }];

describe("searchItems", () => {
  it("finds captions", () => expect(searchItems(items, occasions, "DANCING", "America/Chicago")).toEqual([items[0]]));
  it("finds civil dates", () => expect(searchItems(items, occasions, "2026-02-13", "America/Chicago")).toEqual([items[0]]));
  it("finds occasion names on the same day", () => expect(searchItems(items, occasions, "birthday", "America/Chicago")).toEqual([items[0]]));
  it("finds English month names", () => expect(searchItems(items, occasions, "feb", "America/Chicago")).toEqual([items[0]]));
  it("keeps the original items for an empty query", () => expect(searchItems(items, occasions, "  ", "America/Chicago")).toBe(items));
  it("returns no items when nothing matches", () => expect(searchItems(items, occasions, "cinema", "America/Chicago")).toEqual([]));
});
