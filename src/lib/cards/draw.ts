import type { Card, Mood } from "./types";

export type MoodFilter = Mood | "all";

export interface Draw {
  card: Card;
  /** True when the deck ran out and every card became eligible again. */
  reshuffled: boolean;
}

/**
 * Picks the next question at random from the cards not yet seen.
 *
 * Random rather than sequential, and without repeats until the deck is spent:
 * a fixed order makes the second evening feel like a repeat of the first, and
 * repeats inside one evening make the deck feel smaller than it is.
 *
 * `random` is injected so the interesting behaviour can actually be tested;
 * callers pass Math.random.
 */
export function drawCard(
  deck: readonly Card[],
  seen: ReadonlySet<number>,
  filter: MoodFilter,
  random: () => number,
  currentId?: number,
): Draw | null {
  const eligible = filter === "all" ? deck : deck.filter((c) => c.mood === filter);
  if (eligible.length === 0) return null;

  let pool: readonly Card[] = eligible.filter((c) => !seen.has(c.id));
  let reshuffled = false;

  if (pool.length === 0) {
    // Spent — reopen the deck. Note this reopens only within the current
    // filter: a "deep" run that exhausts its cards must serve deep ones
    // again, not silently start handing out light ones.
    reshuffled = true;
    pool = eligible;
    // Handing back the card already on screen reads as a broken button, so
    // drop it — unless it is genuinely the only one left.
    const withoutCurrent = pool.filter((c) => c.id !== currentId);
    if (withoutCurrent.length > 0) pool = withoutCurrent;
  }

  const card = pool[Math.floor(random() * pool.length) % pool.length];
  return { card, reshuffled };
}
