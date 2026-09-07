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
  /**
   * WHICH song is being held, as the id the room agreed on.
   *
   * `ready` cannot answer that. It says a file is present, and it stays true
   * from the previous song forever -- so when the other person chose a new one,
   * their choice crossed the control channel at once while their bytes were
   * still in flight, and this side went on showing the song before it.
   */
  id: string | null;
  ready: boolean;
  loading: boolean;
  durationSec: number;
  error: string | null;
  /** Hold an mp4 and resolve its length in seconds, or null if unusable. */
  chooseMedia: (
    blob: Blob,
    durationHintSec?: number | null,
    id?: string | null,
  ) => Promise<number | null>;
  clear: () => void;
}

export function useKaraokeTrack(): KaraokeTrack {
  const [file, setFile] = useState<File | null>(null);
  const [id, setId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [durationSec, setDurationSec] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const chooseMedia = useCallback(
    async (
      blob: Blob,
      durationHintSec: number | null = null,
      songId: string | null = null,
    ): Promise<number | null> => {
      setError(null);
      setLoading(true);
      try {
        const result = await prepareTrack(blob, durationHintSec, probeVideoDuration);
        if (!result.ok) {
          setError(MEDIA_MESSAGE[result.reason]);
          return null;
        }

        setFile(result.file);
        setId(songId);
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
    setId(null);
    setReady(false);
    setDurationSec(0);
    setError(null);
  }, []);

  return { file, id, ready, loading, durationSec, error, chooseMedia, clear };
}
