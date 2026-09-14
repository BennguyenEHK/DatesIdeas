import { describe, expect, it } from "vitest";
import { skyLanterns, stepSelection } from "./sky";
import type { AlbumItem } from "./types";

const items = Array.from({ length: 9 }, (_, index) => ({
  id: `memory-${index}`,
  kind: "photo",
  contentType: "image/jpeg",
  bytes: 1,
  happenedAt: "2026-02-01T12:00:00Z",
  createdAt: "2026-02-01T12:00:00Z",
  caption: null,
  loved: false,
  sourceRoom: null,
  url: "https://example.test/memory.jpg",
  posterUrl: null,
})) satisfies AlbumItem[];

describe("skyLanterns", () => {
  it("draws the selected memory and three neighbours on each side", () => {
    const lanterns = skyLanterns(items, "memory-4");
    expect(lanterns.map((lantern) => lantern.slot)).toEqual([-3, -2, -1, 0, 1, 2, 3]);
    expect(lanterns.find((lantern) => lantern.slot === 0)?.item.id).toBe("memory-4");
  });

  it("keeps each lantern's layout deterministic", () => {
    expect(skyLanterns(items, "memory-4")).toEqual(skyLanterns(items, "memory-4"));
  });
});

describe("stepSelection", () => {
  it("clamps at both ends", () => {
    expect(stepSelection(["a", "b"], "a", -1)).toBe("a");
    expect(stepSelection(["a", "b"], "b", 1)).toBe("b");
    expect(stepSelection(["a", "b"], "a", 1)).toBe("b");
  });
});
