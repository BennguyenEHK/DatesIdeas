"use client";

import { useEffect, useState } from "react";
import type { Card } from "./types";

/**
 * Loads the deck once when the room opens.
 *
 * A failed fetch leaves an empty deck and disables drawing, which is the whole
 * consequence: the video call is unaffected. The card game is an extra and
 * must never be able to take the evening down with it.
 */
export function useDeck(): { deck: Card[]; loading: boolean } {
  const [deck, setDeck] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch("/api/cards");
        const body = (await res.json()) as { cards?: Card[] };
        if (!cancelled) setDeck(body.cards ?? []);
      } catch {
        if (!cancelled) setDeck([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { deck, loading };
}
