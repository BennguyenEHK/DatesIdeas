"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createAudioPlayer, type AudioPlayer, type ContextLike } from "./audioPlayer";
import { decodeTrack, type DecodeFailure } from "./decode";
import { parseLrc, type LrcLine } from "./lrc";

/** What went wrong, in words that suggest a next step rather than a code. */
const DECODE_MESSAGE: Record<DecodeFailure, string> = {
  "too-big": "That file is too large to hold in memory. An ordinary song is well under the limit.",
  unreadable: "That file could not be read. Try choosing it again.",
  "not-audio": "This browser cannot decode that file. An MP3 or an M4A is the safest bet.",
  empty: "That file has no audio in it.",
};

export interface KaraokeTrack {
  /** The sync layer's handle, or null before a track has been chosen. */
  player: AudioPlayer | null;
  /** True once there is decoded audio to play. */
  ready: boolean;
  /** True while a file is being decoded. */
  loading: boolean;
  /** Length of the loaded track, for telling the peer which song this is. */
  durationSec: number;
  lyrics: readonly LrcLine[];
  /** A sentence to show someone, or null. */
  error: string | null;
  /**
   * Decode audio and hold it, resolving its length in seconds, or null when it
   * could not be used. The length is the answer the room needs: it is what
   * tells the other side which song this is.
   *
   * Takes a Blob rather than a File so the same path serves both ways a track
   * arrives: picked from this machine, or received from the other side over the
   * data channel and wrapped around its bytes.
   */
  chooseAudio: (file: Blob) => Promise<number | null>;
  /** Read an .lrc file and hold its timed lines. */
  chooseLyrics: (file: File) => Promise<void>;
  /**
   * Hold already-read lyrics text. The helper and the peer both deliver an
   * .lrc as a string rather than a file, and neither should have to build a
   * Blob just to be handed straight back its own contents.
   */
  setLyricsText: (text: string) => void;
  /** Forget the track and release the audio graph. */
  clear: () => void;
}

/**
 * Owns the one AudioContext this app is allowed to have, and the player built
 * on it.
 *
 * A browser permits only a handful of audio contexts per page and never
 * reclaims them on its own, so one is created lazily on the first track and
 * kept for the life of the room. Lazily, because a context constructed before
 * anyone has clicked anything is born suspended under the autoplay policy, and
 * a suspended context's clock does not advance -- which would quietly stop the
 * position maths that everything else here depends on.
 */
export function useKaraokeTrack(): KaraokeTrack {
  // Every ref above the callbacks that write to them: the React Compiler
  // refuses a ref first modified inside a closure declared below it.
  const contextRef = useRef<AudioContext | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);

  const [player, setPlayer] = useState<AudioPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [durationSec, setDurationSec] = useState(0);
  const [lyrics, setLyrics] = useState<readonly LrcLine[]>([]);
  const [error, setError] = useState<string | null>(null);

  const ensurePlayer = useCallback((): AudioPlayer | null => {
    if (playerRef.current !== null) return playerRef.current;
    try {
      const context = new AudioContext();
      contextRef.current = context;
      // The cast is the single seam between the real graph and the narrow
      // interfaces the player is written against, and it is proven safe by a
      // type-level assertion in audioPlayer.test.ts rather than by hope.
      const made = createAudioPlayer(context as unknown as ContextLike);
      playerRef.current = made;
      setPlayer(made);
      return made;
    } catch {
      // A browser with Web Audio disabled leaves karaoke on the YouTube path
      // rather than breaking the room.
      return null;
    }
  }, []);

  const chooseAudio = useCallback(
    async (file: Blob): Promise<number | null> => {
      setError(null);
      setLoading(true);
      try {
        const made = ensurePlayer();
        const context = contextRef.current;
        if (made === null || context === null) {
          setError("This browser cannot play audio this way.");
          return null;
        }

        const result = await decodeTrack(file, context);
        if (!result.ok) {
          setError(DECODE_MESSAGE[result.reason]);
          return null;
        }

        made.setTrack(result.buffer);
        setDurationSec(result.durationSec);
        setReady(true);
        return result.durationSec;
      } finally {
        setLoading(false);
      }
    },
    [ensurePlayer],
  );

  const setLyricsText = useCallback((text: string) => {
    const parsed = parseLrc(text);
    if (parsed.length === 0) {
      // Deliberately not an error that clears the song: the audio is the
      // point and lyrics are the decoration, so a bad .lrc must not cost
      // somebody the track they already loaded.
      setError("No timed lines were found in that file. The song still plays.");
      return;
    }
    setLyrics(parsed);
    setError(null);
  }, []);

  const chooseLyrics = useCallback(
    async (file: File) => {
      try {
        setLyricsText(await file.text());
      } catch {
        setError("That lyrics file could not be read.");
      }
    },
    [setLyricsText],
  );

  const clear = useCallback(() => {
    playerRef.current?.setTrack(null);
    setReady(false);
    setDurationSec(0);
    setLyrics([]);
    setError(null);
  }, []);

  // The context is closed only when the room goes, not when a song changes.
  useEffect(() => {
    return () => {
      playerRef.current?.dispose();
      void contextRef.current?.close().catch(() => {});
    };
  }, []);

  return {
    player,
    ready,
    loading,
    durationSec,
    lyrics,
    error,
    chooseAudio,
    chooseLyrics,
    setLyricsText,
    clear,
  };
}
