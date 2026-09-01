import { describe, it, expect } from "vitest";
import { drawCard } from "./draw";
import type { Card } from "./types";

const deck: Card[] = [
  { id: 1, text: "l1", mood: "light" },
  { id: 2, text: "l2", mood: "light" },
  { id: 3, text: "u1", mood: "us" },
  { id: 4, text: "u2", mood: "us" },
  { id: 5, text: "d1", mood: "deep" },
];

/** Deterministic stand-in for Math.random, cycling through fixed values. */
function fixedRandom(...values: number[]) {
  let i = 0;
  return () => values[i++ % values.length];
}

describe("drawCard", () => {
  it("returns null for an empty deck", () => {
    expect(drawCard([], new Set(), "all", Math.random)).toBeNull();
  });

  it("draws from the whole deck when the mood filter is off", () => {
    const got = drawCard(deck, new Set(), "all", fixedRandom(0));
    expect(got?.card.id).toBe(1);
  });

  it("respects the mood filter", () => {
    // With only "us" eligible, any random value must land on 3 or 4.
    for (const r of [0, 0.4, 0.99]) {
      const got = drawCard(deck, new Set(), "us", fixedRandom(r));
      expect([3, 4]).toContain(got?.card.id);
    }
  });

  it("never repeats a card that has been seen", () => {
    const seen = new Set([1, 3, 4, 5]);
    const got = drawCard(deck, seen, "all", fixedRandom(0.9));
    expect(got?.card.id).toBe(2);
    expect(got?.reshuffled).toBe(false);
  });

  it("reshuffles once every card has been seen", () => {
    const seen = new Set([1, 2, 3, 4, 5]);
    const got = drawCard(deck, seen, "all", fixedRandom(0));
    expect(got).not.toBeNull();
    // The whole deck is eligible again, and the caller is told so it can say so.
    expect(got?.reshuffled).toBe(true);
  });

  it("reshuffles within the filter, not across it", () => {
    // Every "us" card is spent but light ones remain. Filtering to "us" must
    // reopen the us cards rather than quietly serving a light one.
    const seen = new Set([3, 4]);
    const got = drawCard(deck, seen, "us", fixedRandom(0));
    expect([3, 4]).toContain(got?.card.id);
    expect(got?.reshuffled).toBe(true);
  });

  it("returns null when the filter matches nothing in the deck", () => {
    const lightOnly: Card[] = [{ id: 1, text: "l", mood: "light" }];
    expect(drawCard(lightOnly, new Set(), "deep", fixedRandom(0))).toBeNull();
  });

  it("avoids repeating the current card on an immediate reshuffle", () => {
    // Drawing again on a one-card-left filter must not hand back the card
    // already on screen — that reads as a broken button.
    const twoDeep: Card[] = [
      { id: 5, text: "d1", mood: "deep" },
      { id: 6, text: "d2", mood: "deep" },
    ];
    const got = drawCard(twoDeep, new Set([5, 6]), "deep", fixedRandom(0), 5);
    expect(got?.card.id).toBe(6);
  });

  it("still returns the only card when it is also the current one", () => {
    const one: Card[] = [{ id: 5, text: "d1", mood: "deep" }];
    const got = drawCard(one, new Set([5]), "deep", fixedRandom(0), 5);
    expect(got?.card.id).toBe(5);
  });

  it("spreads draws across the eligible cards", () => {
    // Randomness is the requirement: a draw that always returns the first
    // eligible card would pass every test above and still be broken.
    const seen = new Set<number>();
    const ids = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const got = drawCard(deck, seen, "all", Math.random);
      if (!got) break;
      ids.add(got.card.id);
      seen.add(got.card.id);
      if (seen.size === deck.length) seen.clear();
    }
    expect(ids.size).toBe(deck.length);
  });
});
