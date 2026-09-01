export const MOODS = ["light", "us", "deep"] as const;
export type Mood = (typeof MOODS)[number];

/**
 * One question from the deck.
 *
 * `id` is the database row id. It travels over the DataChannel so both peers
 * can track what has already been drawn; the text travels with it so a peer
 * whose deck fetch failed can still display the card rather than showing a
 * blank where a question should be.
 */
export interface Card {
  id: number;
  text: string;
  mood: Mood;
}

export function isMood(v: unknown): v is Mood {
  return typeof v === "string" && (MOODS as readonly string[]).includes(v);
}

export const MOOD_LABELS: Record<Mood, string> = {
  light: "Light",
  us: "Us",
  deep: "Deep",
};
