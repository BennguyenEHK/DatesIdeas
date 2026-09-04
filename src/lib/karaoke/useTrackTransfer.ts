"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  chunkTrack,
  chunkCount,
  createAssembler,
  type Assembler,
} from "@/lib/rtc/fileChannel";
import type { PeerMessage } from "@/lib/rtc/protocol";

/** A track that has fully arrived from the other side. */
export interface ReceivedTrack {
  audio: Blob;
  title: string;
  durationSec: number;
  lrc: string | null;
}

export interface TrackTransfer {
  /** Bytes so far of an inbound transfer, or null when none is running. */
  incoming: { receivedBytes: number; expectedBytes: number } | null;
  /** A sentence about a transfer that failed, or null. */
  error: string | null;
  /** Feed every peer message here; unrelated ones are ignored. */
  handleMessage: (message: PeerMessage) => void;
  /** Push a fetched track to the other side. Resolves when the last chunk is queued. */
  sendTrack: (args: {
    requestId: string;
    audio: ArrayBuffer;
    contentType: string;
    title: string;
    durationSec: number;
    lrc: string | null;
  }) => Promise<void>;
}

/**
 * Waited out when the send buffer is full rather than queueing internally.
 *
 * Short enough that a fast connection barely notices, long enough that this is
 * not a spin loop on a slow one.
 */
const BACKPRESSURE_WAIT_MS = 50;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Moves one karaoke track across the peer connection.
 *
 * Control messages travel on the JSON channel and the bytes on the binary one,
 * which is not merely tidier: the JSON channel also carries playback position,
 * and several megabytes queued ahead of those would block them for the whole
 * transfer and desynchronise the song at exactly the moment it starts.
 */
export function useTrackTransfer(args: {
  sendMessage: (message: PeerMessage) => void;
  sendFileChunk: (chunk: ArrayBuffer) => boolean;
  onFileChunk: (handler: (chunk: ArrayBuffer) => void) => () => void;
  /** Called once a track has fully arrived and passed its integrity check. */
  onReceived: (track: ReceivedTrack) => void;
}): TrackTransfer {
  const { sendMessage, sendFileChunk, onFileChunk, onReceived } = args;

  const [incoming, setIncoming] = useState<{
    receivedBytes: number;
    expectedBytes: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Every ref above the closures that write to them: the React Compiler
  // refuses a ref first modified inside a closure declared below it.
  const assemblerRef = useRef<Assembler | null>(null);
  const pendingRef = useRef<{ title: string; durationSec: number; lrc: string | null } | null>(
    null,
  );
  const onReceivedRef = useRef(onReceived);
  useEffect(() => {
    onReceivedRef.current = onReceived;
  });

  useEffect(() => {
    return onFileChunk((chunk) => {
      const assembler = assemblerRef.current;
      const pending = pendingRef.current;
      // Bytes with no announcement in front of them cannot be placed, and are
      // far more likely to be the tail of an abandoned transfer than anything
      // useful. Dropping them is the whole defence: there is no length here to
      // trust, only what track-meta already promised.
      if (assembler === null || pending === null) return;

      const state = assembler.push(chunk);
      if (state.status === "receiving") {
        setIncoming({
          receivedBytes: state.receivedBytes,
          expectedBytes: state.expectedBytes,
        });
        return;
      }

      assemblerRef.current = null;
      pendingRef.current = null;
      setIncoming(null);

      if (state.status === "failed") {
        setError("The song did not arrive intact. Ask them to send it again.");
        return;
      }

      setError(null);
      onReceivedRef.current({
        // The type is asserted rather than carried: every track the helper
        // produces is AAC in an MP4 container, and decodeAudioData sniffs the
        // container anyway, so a wrong label here costs nothing.
        audio: new Blob([state.bytes], { type: "audio/mp4" }),
        title: pending.title,
        durationSec: pending.durationSec,
        lrc: pending.lrc,
      });
    });
  }, [onFileChunk]);

  const handleMessage = useCallback((message: PeerMessage) => {
    if (message.t === "track-meta") {
      assemblerRef.current = createAssembler(message.chunks, message.bytes);
      pendingRef.current = {
        title: message.title,
        durationSec: message.durationSec,
        lrc: message.lrc,
      };
      setError(null);
      setIncoming({ receivedBytes: 0, expectedBytes: message.bytes });
      return;
    }

    if (message.t === "track-error") {
      assemblerRef.current = null;
      pendingRef.current = null;
      setIncoming(null);
      setError(message.message);
      return;
    }

    if (message.t === "track-done") {
      // Arrives after the last chunk, so a live assembler here means chunks
      // went missing on the way. Without this the transfer would simply hang
      // with a progress bar that never fills.
      if (assemblerRef.current !== null) {
        assemblerRef.current = null;
        pendingRef.current = null;
        setIncoming(null);
        setError("The song did not arrive intact. Ask them to send it again.");
      }
    }
  }, []);

  const sendTrack = useCallback(
    async (track: {
      requestId: string;
      audio: ArrayBuffer;
      contentType: string;
      title: string;
      durationSec: number;
      lrc: string | null;
    }) => {
      sendMessage({
        t: "track-meta",
        requestId: track.requestId,
        title: track.title,
        durationSec: track.durationSec,
        bytes: track.audio.byteLength,
        chunks: chunkCount(track.audio.byteLength),
        lrc: track.lrc,
      });

      for (const chunk of chunkTrack(track.audio)) {
        // Retries rather than queues: the channel reports when its buffer is
        // full, and pushing past that is how a data channel gets dropped.
        while (!sendFileChunk(chunk)) await wait(BACKPRESSURE_WAIT_MS);
      }

      sendMessage({ t: "track-done", requestId: track.requestId });
    },
    [sendMessage, sendFileChunk],
  );

  return { incoming, error, handleMessage, sendTrack };
}
