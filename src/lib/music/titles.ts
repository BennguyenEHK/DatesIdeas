"use client";

import { useEffect, useState } from "react";

export interface VideoInfo {
  title: string;
  author: string;
}

/**
 * Every lookup made on this page, kept for as long as the page is open.
 *
 * Promises rather than answers, so two parts of the bar asking about the same
 * song at once share one request. A definite "no such video" is remembered
 * too; a failure that might be temporary is forgotten so the next ask tries
 * again.
 */
const lookups = new Map<string, Promise<VideoInfo | null>>();
const answers = new Map<string, VideoInfo | null>();

/**
 * A song's title and channel, or null when YouTube does not know it.
 *
 * Goes through the app's own /api/oembed because YouTube's endpoint cannot be
 * read from a page directly. Never throws: a title is a nicety, and the bar
 * shows the video id until one arrives.
 */
export function fetchVideoInfo(videoId: string): Promise<VideoInfo | null> {
  const pending = lookups.get(videoId);
  if (pending) return pending;

  const lookup = (async () => {
    try {
      const res = await fetch(
        `/api/oembed?videoId=${encodeURIComponent(videoId)}`,
      );
      if (res.status === 404) {
        answers.set(videoId, null);
        return null;
      }
      if (!res.ok) throw new Error(`oembed ${res.status}`);
      const body = (await res.json()) as Partial<VideoInfo>;
      if (typeof body.title !== "string")
        throw new Error("oembed without a title");
      const info = {
        title: body.title,
        author: typeof body.author === "string" ? body.author : "",
      };
      answers.set(videoId, info);
      return info;
    } catch {
      lookups.delete(videoId);
      return null;
    }
  })();
  lookups.set(videoId, lookup);
  return lookup;
}

/** What is already known about a song, without asking anyone. */
export function knownVideoInfo(videoId: string): VideoInfo | null {
  return answers.get(videoId) ?? null;
}

/**
 * Looks up several songs at once and returns the titles that were found, by
 * video id. The shape `setTitles` takes, so one broadcast carries them all.
 */
export async function fetchTitles(
  videoIds: string[],
): Promise<Record<string, string>> {
  const unique = [...new Set(videoIds)];
  const infos = await Promise.all(unique.map(fetchVideoInfo));
  const titles: Record<string, string> = {};
  unique.forEach((id, i) => {
    const info = infos[i];
    if (info) titles[id] = info.title;
  });
  return titles;
}

/**
 * A song's title and channel for display, filled in once it has been looked up.
 *
 * The answer is stored alongside the id it belongs to and only used while that
 * id is still the one asked about, so a song change never shows the previous
 * song's channel -- and never needs a reset inside the effect to avoid it.
 */
export function useVideoInfo(videoId: string | null): VideoInfo | null {
  const [found, setFound] = useState<{
    videoId: string;
    info: VideoInfo | null;
  } | null>(null);

  useEffect(() => {
    if (videoId === null) return;
    let live = true;
    fetchVideoInfo(videoId).then((info) => {
      if (live) setFound({ videoId, info });
    });
    return () => {
      live = false;
    };
  }, [videoId]);

  if (videoId === null) return null;
  if (found?.videoId === videoId) return found.info;
  return knownVideoInfo(videoId);
}
