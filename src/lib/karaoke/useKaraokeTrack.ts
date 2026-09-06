"use client";

import { useCallback, useState } from "react";
import { prepareTrack, probeVideoDuration, type MediaFailure } from "./decode";

/** What went wrong, in words that suggest a next step rather than a code. */
const MEDIA_MESSAGE: Record<MediaFailure, string> = {
  "too-big": "That file is too large to hold in memory. An ordinary song is well under the limit.",
  unreadable: "That file could not be read. Try choosing it again.",
  empty: "That file has no video in it.",
  "no-duration": "This browser could not determine that video's length. Try another file.",
};

export interface KaraokeTrack {
  /** The mp4 held in memory, ready for a <video> player, or null. */
  file: File | null;
  ready: boolean;
  loading: boolean;
  durationSec: number;
  error: string | null;
  /** Hold an mp4 and resolve its length in seconds, or null if unusable. */
  chooseMedia: (blob: Blob, durationHintSec?: number | null) => Promise<number | null>;
  clear: () => void;
}

export function useKaraokeTrack(): KaraokeTrack {
  const [file, setFile] = useState<File | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [durationSec, setDurationSec] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const chooseMedia = useCallback(
    async (blob: Blob, durationHintSec: number | null = null): Promise<number | null> => {
      setError(null);
      setLoading(true);
      try {
        const result = await prepareTrack(blob, durationHintSec, probeVideoDuration);
        if (!result.ok) {
          setError(MEDIA_MESSAGE[result.reason]);
          return null;
        }

        setFile(result.file);
        setDurationSec(result.durationSec);
        setReady(true);
        return result.durationSec;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const clear = useCallback(() => {
    setFile(null);
    setReady(false);
    setDurationSec(0);
    setError(null);
  }, []);

  return { file, ready, loading, durationSec, error, chooseMedia, clear };
}
