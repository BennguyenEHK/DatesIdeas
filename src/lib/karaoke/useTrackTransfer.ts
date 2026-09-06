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
  media: Blob;
  title: string;
  durationSec: number;
}

/**
 * How a send ended.
 *
 * Reported rather than swallowed, because a song that loaded on this machine
 * and never reached the other person looked identical from here to one that
 * arrived. The only symptom was on their screen, which is the worst possible
 * place for it: the person who could act on it could not see it.
 */
export type SendOutcome =
  /** Every chunk was handed to the channel. */
  | "sent"
  /** No file channel ever opened. Nobody was there to send to. */
  | "no-peer"
  /** The channel was there and went away part way through. */
  | "peer-left"
  /** The channel stayed open and stopped accepting bytes. */
  | "stalled";

export interface TrackTransfer {
  /** Bytes so far of an inbound transfer, or null when none is running. */
  incoming: { receivedBytes: number; expectedBytes: number } | null;
  /** A sentence about a transfer that failed, in either direction, or null. */
  error: string | null;
  /** Feed every peer message here; unrelated ones are ignored. */
  handleMessage: (message: PeerMessage) => void;
  /** Push a fetched track to the other side, and say how it went. */
  sendTrack: (args: {
    requestId: string;
    media: ArrayBuffer;
    contentType: string;
    title: string;
    durationSec: number;
  }) => Promise<SendOutcome>;
}

/**
 * Waited out when the send buffer is full rather than queueing internally.
 *
 * Short enough that a fast connection barely notices, long enough that this is
 * not a spin loop on a slow one.
 */
const BACKPRESSURE_WAIT_MS = 50;

/**
 * How long one chunk may sit unaccepted by an OPEN channel before the send is
 * abandoned.
 *
 * Real backpressure clears in milliseconds, so this is not a budget -- it is a
 * floor under a case the channel state cannot express: open, and never willing.
 * Without it, that case is the same endless loop as a closed channel.
 */
const SEND_GIVE_UP_MS = 15_000;

/**
 * How long to let a file channel finish opening before deciding nobody is there.
 *
 * A data channel is not open the instant the other person appears, and a fetch
 * can easily land inside that gap. Asking once and giving up reads "still
 * connecting" as "alone", which costs the other person the song entirely --
 * they are left watching a player that was never sent anything. Waiting instead
 * costs a few seconds in the case where they really are absent.
 */
const CHANNEL_OPEN_WAIT_MS = 10_000;

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
  /** Whether there is anyone to send to. See the retry loop in sendTrack. */
  fileChannelOpen: () => boolean;
  onFileChunk: (handler: (chunk: ArrayBuffer) => void) => () => void;
  /** Called once a track has fully arrived and passed its integrity check. */
  onReceived: (track: ReceivedTrack) => void;
}): TrackTransfer {
  const { sendMessage, sendFileChunk, fileChannelOpen, onFileChunk, onReceived } = args;

  const [incoming, setIncoming] = useState<{
    receivedBytes: number;
    expectedBytes: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Every ref above the closures that write to them: the React Compiler
  // refuses a ref first modified inside a closure declared below it.
  const assemblerRef = useRef<Assembler | null>(null);
  const pendingRef = useRef<{ title: string; durationSec: number } | null>(null);
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
        // The type is asserted rather than carried, and now it matters more than
        // it used to: a <video> element decides whether to show a picture from
        // this label, where the old audio path sniffed the container and could
        // not be misled by a wrong one.
        media: new Blob([state.bytes], { type: "video/mp4" }),
        title: pending.title,
        durationSec: pending.durationSec,
      });
    });
  }, [onFileChunk]);

  const handleMessage = useCallback((message: PeerMessage) => {
    if (message.t === "track-meta") {
      assemblerRef.current = createAssembler(message.chunks, message.bytes);
      pendingRef.current = {
        title: message.title,
        durationSec: message.durationSec,
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
      media: ArrayBuffer;
      contentType: string;
      title: string;
      durationSec: number;
    }): Promise<SendOutcome> => {
      // Give the channel a chance to finish opening before concluding there is
      // nobody on the other end. The track is already loaded on this side, so
      // this is never fatal here -- but it is always worth saying, because the
      // consequence lands entirely on the other person's screen.
      for (let waited = 0; !fileChannelOpen(); waited += BACKPRESSURE_WAIT_MS) {
        if (waited >= CHANNEL_OPEN_WAIT_MS) {
          setError(
            "The song is playing here, but it could not be sent to them — no file connection opened.",
          );
          return "no-peer";
        }
        await wait(BACKPRESSURE_WAIT_MS);
      }

      sendMessage({
        t: "track-meta",
        requestId: track.requestId,
        title: track.title,
        durationSec: track.durationSec,
        bytes: track.media.byteLength,
        chunks: chunkCount(track.media.byteLength),
      });

      for (const chunk of chunkTrack(track.media)) {
        // Retries rather than queues: the channel reports when its buffer is
        // full, and pushing past that is how a data channel gets dropped.
        let waited = 0;
        for (;;) {
          let accepted: boolean;
          try {
            accepted = sendFileChunk(chunk);
          } catch {
            // dc.send() throws when the channel closes under it. Uncaught this
            // became an unhandled rejection, which is how a failed send managed
            // to leave no trace anywhere at all.
            accepted = false;
          }
          if (accepted) break;

          // One `false`, two opposite meanings. A full buffer drains if you
          // wait; a closed channel does not, and waiting on it is a loop with
          // no exit -- which is what this did, twenty times a second, for as
          // long as the page stayed open.
          if (!fileChannelOpen()) {
            setError("They dropped out part way through the song. Try loading it again.");
            return "peer-left";
          }
          // A backstop for the case the channel is open but permanently
          // unwilling. Far longer than real backpressure, which clears in
          // milliseconds, and still finite.
          if (waited >= SEND_GIVE_UP_MS) {
            setError("The song stopped going through to them. Try loading it again.");
            return "stalled";
          }
          await wait(BACKPRESSURE_WAIT_MS);
          waited += BACKPRESSURE_WAIT_MS;
        }
      }

      sendMessage({ t: "track-done", requestId: track.requestId });
      setError(null);
      return "sent";
    },
    [sendMessage, sendFileChunk, fileChannelOpen],
  );

  return { incoming, error, handleMessage, sendTrack };
}
