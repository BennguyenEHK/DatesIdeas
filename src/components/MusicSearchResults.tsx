"use client";

import { useState } from "react";
import type { SearchResult } from "@/lib/music/search";

interface MusicSearchResultsProps {
  status: "idle" | "loading" | "done" | "unavailable" | "error";
  results: SearchResult[];
  onAdd: (videoId: string) => void;
}

export function MusicSearchResults({ status, results, onAdd }: MusicSearchResultsProps) {
  const [added, setAdded] = useState<Set<string>>(new Set());
  const message = status === "loading"
    ? "Searching…"
    : status === "done" && results.length === 0
      ? "No songs found"
      : status === "unavailable"
        ? "Search isn't set up — paste a link instead"
        : status === "error"
          ? "Couldn't search right now"
          : null;

  return (
    <div className="w-full basis-full" aria-live="polite">
      {message ? <p className="pb-1 text-[0.65rem]">{message}</p> : null}
      {results.length > 0 ? (
        <ul className="divide-y divide-[var(--edge)] rounded-[2px] border border-[var(--edge)] bg-[var(--dusk)]">
          {results.map((result) => {
            const isAdded = added.has(result.videoId);
            return (
              <li key={result.videoId} className="flex items-center gap-2 px-2 py-1.5">
                {result.thumbnail ? (
                  // A 64px thumbnail from YouTube's own host, not worth routing
                  // through the image optimiser.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={result.thumbnail} alt="" className="h-9 w-16 shrink-0 rounded-[2px] object-cover" />
                ) : <span className="h-9 w-16 shrink-0 rounded-[2px] bg-[var(--letterbox)]" aria-hidden />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[var(--cream)]">{result.title}</span>
                  <span className="block truncate text-[0.65rem]">{result.channel}</span>
                </span>
                <button
                  type="button"
                  onClick={() => { onAdd(result.videoId); setAdded((current) => new Set(current).add(result.videoId)); }}
                  className="shrink-0 rounded-[2px] border border-[var(--edge)] px-2 py-1 text-[var(--mist)] hover:text-[var(--cream)]"
                  aria-label={isAdded ? `Added ${result.title}` : `Add ${result.title}`}
                >
                  {isAdded ? "Added" : "Add"}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
