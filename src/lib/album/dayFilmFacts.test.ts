import { describe, expect, it } from "vitest";
import { dayFilmFacts } from "./dayFilmFacts";
import type { AlbumItem, Occasion } from "./types";

function item(id: string, happenedAt: string, caption: string | null = null): AlbumItem {
  return {
    id,
    kind: "photo",
    contentType: "image/jpeg",
    bytes: 1,
    happenedAt,
    createdAt: happenedAt,
    caption,
    loved: false,
    sourceRoom: null,
    url: `https://example.test/${id}.jpg`,
    posterUrl: null,
  };
}

const EMPTY: Occasion[] = [];

describe("dayFilmFacts", () => {
  it("formats the civil date in UTC and keeps the day's play order", () => {
    const facts = dayFilmFacts(
      [
        item("late", "2026-09-13T03:30:00Z", "last"),
        item("early", "2026-09-12T15:00:00Z", "first"),
      ],
      EMPTY,
      "2026-09-12",
      "America/Chicago",
    );

    expect(facts.title).toBe("Saturday, 12 September 2026");
    expect(facts.items.map((memory) => memory.id)).toEqual(["early", "late"]);
    expect(facts.closing).toBe("first");
  });

  it("finds yearly occasions in a later year and one-off occasions", () => {
    const occasions: Occasion[] = [
      {
        id: "yearly",
        title: "Our anniversary",
        onDate: "2021-04-07",
        yearly: true,
        coverItemId: null,
      },
      { id: "once", title: "The concert", onDate: "2026-04-08", yearly: false, coverItemId: null },
    ];

    expect(dayFilmFacts([], occasions, "2026-04-07", "UTC").subtitle).toBe("Our anniversary");
    expect(dayFilmFacts([], occasions, "2026-04-08", "UTC").subtitle).toBe("The concert");
  });

  it("uses null for missing occasion and caption", () => {
    const facts = dayFilmFacts(
      [item("one", "2026-04-07T12:00:00Z", "")],
      EMPTY,
      "2026-04-07",
      "UTC",
    );
    expect(facts.subtitle).toBeNull();
    expect(facts.closing).toBeNull();
  });
});
