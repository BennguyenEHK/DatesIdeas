"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchTrack,
  isYouTubeUrl,
  HELPER_MESSAGE,
  type HelperTrack,
} from "./helperClient";

/**
 * Where a request has got to, in the order someone would experience it.
 *
 * "fetching" is the long one — yt-dlp is downloading on the machine running the
 * helper — and it is the reason this state exists at all. Half a minute with no
 * indication of progress reads as a broken app, so every stage here is a thing
 * the panel can say out loud.
 */
export type HelperStage = "idle" | "fetching" | "ready" | "failed";

export interface KaraokeHelper {
  stage: HelperStage;
  /** Null until the endpoint has been looked up; false when none is registered. */
  available: boolean | null;
  error: string | null;
  /** Fetches a track through the helper. Resolves null when it could not. */
  request: (youtubeUrl: string) => Promise<HelperTrack | null>;
  /** Forget a failure so the picker stops showing it. */
  reset: () => void;
}

interface Endpoint {
  url: string;
  token: string;
}

/**
 * Reads the registered endpoint and a short-lived pass to use it.
 *
 * Fetched per request rather than once, because the token expires in minutes
 * and the tunnel URL changes whenever the helper restarts. Both are cheap to
 * ask for and stale versions of either fail confusingly.
 */
async function readEndpoint(): Promise<Endpoint | null> {
  try {
    const response = await fetch("/api/helper", { cache: "no-store" });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return null;
    const { url, token } = body as Record<string, unknown>;
    if (typeof url !== "string" || typeof token !== "string") return null;
    return { url, token };
  } catch {
    return null;
  }
}

/**
 * Talks to the karaoke helper running on this person's own computer.
 *
 * The helper exists because YouTube refuses datacenter IP addresses, so the
 * fetching cannot happen on the server this app is deployed to. Only the side
 * that actually has a helper calls this; the other side receives the result
 * over the peer connection and never knows it was involved.
 */
export function useKaraokeHelper(): KaraokeHelper {
  const [stage, setStage] = useState<HelperStage>("idle");
  const [available, setAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Asked once on mount so the panel can offer the YouTube tab honestly rather
  // than discovering there is no helper only after someone pastes a link.
  useEffect(() => {
    let cancelled = false;
    void readEndpoint().then((endpoint) => {
      if (!cancelled) setAvailable(endpoint !== null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const request = useCallback(
    async (youtubeUrl: string): Promise<HelperTrack | null> => {
      if (!isYouTubeUrl(youtubeUrl)) {
        setError(HELPER_MESSAGE["bad-url"]);
        setStage("failed");
        return null;
      }

      setError(null);
      setStage("fetching");

      const endpoint = await readEndpoint();
      if (endpoint === null) {
        setAvailable(false);
        setError(HELPER_MESSAGE["helper-unreachable"]);
        setStage("failed");
        return null;
      }
      setAvailable(true);

      const result = await fetchTrack(endpoint.url, endpoint.token, youtubeUrl);
      if (!result.ok) {
        setError(HELPER_MESSAGE[result.reason]);
        setStage("failed");
        return null;
      }

      setStage("ready");
      return result.track;
    },
    [],
  );

  const reset = useCallback(() => {
    setStage("idle");
    setError(null);
  }, []);

  return { stage, available, error, request, reset };
}
