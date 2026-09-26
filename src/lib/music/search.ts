"use client";

import { useEffect, useState } from "react";

export interface SearchResult {
  videoId: string;
  title: string;
  channel: string;
  thumbnail: string | null;
}

export type SearchResponse =
  | { results: SearchResult[] }
  | { unavailable: true }
  | { error: true };

/**
 * Every search made on this page, by its text. Each one costs a hundred units
 * of the key's daily ten thousand, so asking twice for the same words is not
 * free, and typing back over a query is common.
 */
const cache = new Map<string, Promise<SearchResponse>>();

export function searchVideos(query: string, signal?: AbortSignal): Promise<SearchResponse> {
  const normalized = query.trim();
  if (normalized.length === 0) return Promise.resolve({ results: [] });

  let pending = cache.get(normalized);
  if (!pending) {
    const controller = new AbortController();
    pending = fetch(`/api/music/search?q=${encodeURIComponent(normalized)}`, {
      signal: controller.signal,
    }).then(async (response): Promise<SearchResponse> => {
      if (response.status === 503) return { unavailable: true };
      if (!response.ok) return { error: true };
      const body = (await response.json()) as { results?: SearchResult[] };
      return Array.isArray(body.results) ? { results: body.results } : { error: true };
    }).catch((): SearchResponse => ({ error: true }));
    // Only answers are remembered. A failure may be a passing one, and
    // remembering it would refuse the same search until the page reloads.
    void pending.then((answer) => {
      if (!("results" in answer)) cache.delete(normalized);
    });
    cache.set(normalized, pending);
  }

  if (!signal) return pending;
  return new Promise<SearchResponse>((resolve) => {
    if (signal.aborted) {
      resolve({ error: true });
      return;
    }
    const abort = () => resolve({ error: true });
    signal.addEventListener("abort", abort, { once: true });
    pending!.then((result) => {
      signal.removeEventListener("abort", abort);
      if (!signal.aborted) resolve(result);
    });
  });
}

export type VideoSearchStatus = "idle" | "loading" | "done" | "unavailable" | "error";

export function useVideoSearch(query: string): {
  status: VideoSearchStatus;
  results: SearchResult[];
} {
  const normalized = query.trim();
  const [state, setState] = useState<{ query: string; status: VideoSearchStatus; results: SearchResult[] }>({
    query: "",
    status: "idle",
    results: [],
  });

  useEffect(() => {
    if (normalized.length < 2) {
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setState({ query: normalized, status: "loading", results: [] });
      void searchVideos(normalized, controller.signal).then((answer) => {
        if (controller.signal.aborted) return;
        if ("unavailable" in answer) setState({ query: normalized, status: "unavailable", results: [] });
        else if ("error" in answer) setState({ query: normalized, status: "error", results: [] });
        else setState({ query: normalized, status: "done", results: answer.results });
      });
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [normalized]);

  return normalized.length < 2 || state.query !== normalized
    ? { status: "idle", results: [] }
    : { status: state.status, results: state.results };
}
