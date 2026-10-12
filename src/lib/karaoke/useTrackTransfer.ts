"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  chunkTrack,
  chunkCount,
  createAssembler,
  type Assembler,
} from "@/lib/rtc/fileChannel";
import { EMPTY_LINK, type LinkSnapshot } from "@/lib/rtc/linkSnapshot";
import type { PeerMessage } from "@/lib/rtc/protocol";
import {
  downloadTrack,
  requestTrackSlot,
  uploadTrack,
  type TrackSlot,
} from "./bucketTransfer";
import { nextSendAt, paceKbps, shouldHold } from "./transferPacer";

/** A track that has fully arrived from the other side. */
export interface ReceivedTrack {
  media: Blob;
  title: string;
  durationSec: number;
  /** Carried through from the announcement so the sender can be told it landed. */
  requestId: string;
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

/** A fetched track on its way to the other side. */
export interface TrackToSend {
  requestId: string;
  media: ArrayBuffer;
  contentType: string;
  title: string;
  durationSec: number;
}

/**
 * The storage bucket, as this hook uses it.
 *
 * Passed in rather than imported at the call site so a test can stand in for
 * the network; the real module is the default.
 */
export interface TrackBucket {
  requestTrackSlot: typeof requestTrackSlot;
  uploadTrack: typeof uploadTrack;
  downloadTrack: typeof downloadTrack;
}

const REAL_BUCKET: TrackBucket = {
  requestTrackSlot,
  uploadTrack,
  downloadTrack,
};

export interface TrackTransfer {
  /** Bytes so far of an inbound transfer, or null when none is running. */
  incoming: { receivedBytes: number; expectedBytes: number } | null;
  /** A sentence about a transfer that failed, in either direction, or null. */
  error: string | null;
  /** Feed every peer message here; unrelated ones are ignored. */
  handleMessage: (message: PeerMessage) => void;
  /** Push a fetched track to the other side, and say how it went. */
  sendTrack: (args: TrackToSend) => Promise<SendOutcome>;
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

/**
 * How long a transfer may go quiet, once the sender says it is finished, before
 * it is declared lost.
 *
 * The finished marker travels on the control channel and the bytes on the file
 * channel, and those are two independent SCTP streams with no ordering between
 * them. A one-line message on an idle stream overtakes megabytes still draining
 * out of a busy one -- over a relay at a couple of hundred kbps, by minutes. So
 * the marker arriving is not evidence that the rest is not still on its way,
 * and acting on it as though it were is what threw the song away.
 *
 * Silence is the evidence. Bytes on a single stream arrive in order, so once
 * they stop for this long with nothing more coming, they have stopped for good.
 */
const AFTER_DONE_QUIET_MS = 20_000;

/**
 * How often a held send looks again at whether the voice has recovered.
 *
 * Often enough that the song resumes promptly, and a hold costs nothing but
 * a timer: no bytes move while it waits.
 */
const HOLD_POLL_MS = 250;

/**
 * How long a pacing rate is trusted before it is read again.
 *
 * The estimate it comes from moves on the scale of a stats poll, not a chunk,
 * so reading it for every one of them would only follow its noise.
 */
const RATE_REFRESH_MS = 500;

/**
 * How long a send waits for a dropped file channel to come back before giving up.
 *
 * A rebuild of the call takes seconds, sometimes tens of them, and the song is
 * already part way across. Giving up the instant the channel closed threw away
 * every byte already sent for a gap that was about to close on its own.
 */
const REJOIN_WAIT_MS = 60_000;

/**
 * How long, once the channel is back, to wait for the receiver to say where it
 * got to before starting the song over.
 *
 * A receiver on an older build never answers, and one that lost its partial song
 * has nothing to resume. Either way the sender must not wait for ever.
 */
const RESUME_ANSWER_WAIT_MS = 10_000;

/** How often a send waiting out a dropped channel looks at it again. */
const REJOIN_POLL_MS = 100;

/**
 * How often the receiver looks at whether its file channel has come back.
 *
 * The channel's own events belong to the connection hook; polling the same
 * `fileChannelOpen` the sender uses keeps this one free of them.
 */
const CHANNEL_WATCH_MS = 500;

/** The least time between two upload progress reports to the other person. */
const PROGRESS_INTERVAL_MS = 500;

/** How many abandoned requests are remembered, so a stale message is recognised. */
const REMEMBERED_REQUESTS = 32;

function unknownLink(): LinkSnapshot {
  return EMPTY_LINK;
}

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
  /**
   * What the link can carry and how the voice is faring, read as the song is
   * sent so it can be paced and held. Without it the song goes at a
   * relay-sized guess, never flat out.
   */
  linkSnapshot?: () => LinkSnapshot;
  /** The room the song is stored under while it is in the bucket. */
  roomCode: string;
  /**
   * Holds this side's camera off while a song is going out, so the voice and
   * the song have the link to themselves. Called with true when a send starts
   * and false when the last one ends, however it ends.
   */
  holdCamera?: (on: boolean) => void;
  /** The storage bucket; the real one unless a test supplies another. */
  bucket?: TrackBucket;
}): TrackTransfer {
  const {
    sendMessage,
    sendFileChunk,
    fileChannelOpen,
    onFileChunk,
    onReceived,
    linkSnapshot = unknownLink,
    roomCode,
    holdCamera,
    bucket = REAL_BUCKET,
  } = args;

  const [incoming, setIncoming] = useState<{
    receivedBytes: number;
    expectedBytes: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Every ref above the closures that write to them: the React Compiler
  // refuses a ref first modified inside a closure declared below it.
  const assemblerRef = useRef<Assembler | null>(null);
  const pendingRef = useRef<{
    title: string;
    durationSec: number;
    requestId: string;
  } | null>(null);
  const doneRef = useRef(false);
  const quietTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onReceivedRef = useRef(onReceived);
  // Things the long-lived callbacks below read at the moment they run, not as
  // they were when the callback was made: a caller passing a fresh function on
  // every render must not restart a download or a watch half way through.
  const bucketRef = useRef(bucket);
  const holdCameraRef = useRef(holdCamera);
  const roomCodeRef = useRef(roomCode);
  const sendMessageRef = useRef(sendMessage);
  const fileChannelOpenRef = useRef(fileChannelOpen);
  // Receiving: which request is current, which have been left behind, and the
  // download that belongs to the current one (a new number cancels the old).
  const latestRequestRef = useRef<string | null>(null);
  const supersededRef = useRef<Set<string>>(new Set());
  const downloadGenRef = useRef(0);
  const downloadingRef = useRef<string | null>(null);
  const channelWasOpenRef = useRef<boolean | null>(null);
  // Sending: the song last handed over by link (kept in case they cannot fetch
  // it), the receiver's latest "carry on from here", and how many sends want
  // the camera held.
  const lastBucketTrackRef = useRef<TrackToSend | null>(null);
  const resumeRef = useRef<{ requestId: string; fromChunk: number } | null>(
    null,
  );
  const holdsRef = useRef(0);
  useEffect(() => {
    onReceivedRef.current = onReceived;
    bucketRef.current = bucket;
    holdCameraRef.current = holdCamera;
    roomCodeRef.current = roomCode;
    sendMessageRef.current = sendMessage;
    fileChannelOpenRef.current = fileChannelOpen;
  });

  /** Forgets a transfer without judging it: a new one, or one already settled. */
  const stopWaiting = useCallback(() => {
    if (quietTimerRef.current !== null) {
      clearTimeout(quietTimerRef.current);
      quietTimerRef.current = null;
    }
    doneRef.current = false;
  }, []);

  /**
   * Restarts the countdown that ends a finished-but-incomplete transfer.
   *
   * Restarted by every chunk, so a transfer that is merely slow is never cut
   * off -- only one that has actually stopped.
   */
  const waitForTheRest = useCallback(() => {
    if (quietTimerRef.current !== null) clearTimeout(quietTimerRef.current);
    quietTimerRef.current = setTimeout(() => {
      quietTimerRef.current = null;
      doneRef.current = false;
      if (assemblerRef.current === null) return;
      assemblerRef.current = null;
      pendingRef.current = null;
      setIncoming(null);
      setError("The song did not arrive intact. Ask them to send it again.");
    }, AFTER_DONE_QUIET_MS);
  }, []);

  // A page that closes mid-song should not leave a timer holding the tab awake.
  useEffect(() => stopWaiting, [stopWaiting]);

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
        // Arriving bytes outrank anything the control channel has claimed: the
        // sender may have announced it was finished several megabytes ago.
        if (doneRef.current) waitForTheRest();
        setIncoming({
          receivedBytes: state.receivedBytes,
          expectedBytes: state.expectedBytes,
        });
        return;
      }

      stopWaiting();
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
        requestId: pending.requestId,
      });
    });
  }, [onFileChunk, stopWaiting, waitForTheRest]);

  // Notices the file channel coming back while a song is part way in, and says
  // how much of it is already here.
  //
  // The partial song is kept when the channel drops, because the sender is
  // waiting for it to return and can carry on from where it stopped. Polled
  // rather than driven by an event so this hook needs nothing from the
  // connection beyond the `fileChannelOpen` the sender already uses.
  useEffect(() => {
    const timer = setInterval(() => {
      const assembler = assemblerRef.current;
      const pending = pendingRef.current;
      if (assembler === null || pending === null) {
        channelWasOpenRef.current = null;
        return;
      }
      const open = fileChannelOpenRef.current();
      const wasOpen = channelWasOpenRef.current;
      channelWasOpenRef.current = open;
      if (wasOpen !== false || !open) return;
      // Chunks arrive in order on one stream, so the count held is the index of
      // the next one needed. Anything the old channel was still carrying when it
      // died is simply sent again from there.
      sendMessageRef.current({
        t: "track-resume",
        requestId: pending.requestId,
        fromChunk: assembler.receivedChunks,
      });
    }, CHANNEL_WATCH_MS);
    return () => clearInterval(timer);
  }, []);

  /**
   * Records that a request is now the current one, and drops what belonged to
   * the one before it. False when the request is one already left behind.
   *
   * Messages arrive in the order they were sent, so a message for a request
   * that a newer one has already replaced is a late straggler -- an upload that
   * finished after the person asked for something else. Acting on it would
   * bring the old song back over the new one.
   */
  const noteRequest = useCallback(
    (requestId: string): boolean => {
      if (supersededRef.current.has(requestId)) return false;
      const latest = latestRequestRef.current;
      if (latest !== null && latest !== requestId) {
        supersededRef.current.add(latest);
        if (supersededRef.current.size > REMEMBERED_REQUESTS) {
          const oldest = supersededRef.current.values().next().value;
          if (oldest !== undefined) supersededRef.current.delete(oldest);
        }
        stopWaiting();
        assemblerRef.current = null;
        pendingRef.current = null;
        downloadGenRef.current += 1;
        downloadingRef.current = null;
      }
      latestRequestRef.current = requestId;
      return true;
    },
    [stopWaiting],
  );

  /** Fetches a song the sender has left in the bucket. */
  const startDownload = useCallback(
    (offer: {
      requestId: string;
      url: string;
      title: string;
      durationSec: number;
      bytes: number;
    }) => {
      const generation = downloadGenRef.current + 1;
      downloadGenRef.current = generation;
      downloadingRef.current = offer.requestId;
      setError(null);
      // The bar's first half was the upload; this is its second, so it starts
      // where the upload left it and only ever goes forward.
      let shown = Math.floor(offer.bytes / 2);
      setIncoming({ receivedBytes: shown, expectedBytes: offer.bytes });

      void (async () => {
        let buffer: ArrayBuffer | null = null;
        try {
          buffer = await bucketRef.current.downloadTrack(
            offer.url,
            offer.bytes,
            (receivedBytes) => {
              if (downloadGenRef.current !== generation) return;
              shown = Math.max(
                shown,
                Math.min(
                  offer.bytes,
                  Math.floor(offer.bytes / 2 + receivedBytes / 2),
                ),
              );
              setIncoming({ receivedBytes: shown, expectedBytes: offer.bytes });
            },
          );
        } catch {
          buffer = null;
        }

        // Another song was announced while this one downloaded: it is no longer
        // wanted, and adopting it would replace the one that is.
        if (downloadGenRef.current !== generation) return;
        downloadingRef.current = null;

        // A short or long file is as unusable as none at all.
        if (buffer === null || buffer.byteLength !== offer.bytes) {
          // The bar stays up: the sender answers this by sending the song over
          // the call instead, and that is what it is now waiting for.
          sendMessageRef.current({
            t: "track-url-failed",
            requestId: offer.requestId,
          });
          return;
        }

        setIncoming(null);
        setError(null);
        onReceivedRef.current({
          media: new Blob([buffer], { type: "video/mp4" }),
          title: offer.title,
          durationSec: offer.durationSec,
          requestId: offer.requestId,
        });
      })();
    },
    [],
  );

  /** Holds the camera off for one more send; the first one actually does it. */
  const acquireCamera = useCallback(() => {
    holdsRef.current += 1;
    if (holdsRef.current === 1) holdCameraRef.current?.(true);
  }, []);

  /**
   * Lets go of the camera for one send; the last one actually does it.
   *
   * Counted because a song handed over by link can be followed, minutes later,
   * by the same song sent over the call, and a second song can be asked for
   * while the first is still going. The first to finish must not give the
   * camera back to a send that is still running.
   */
  const releaseCamera = useCallback(() => {
    holdsRef.current = Math.max(0, holdsRef.current - 1);
    if (holdsRef.current === 0) holdCameraRef.current?.(false);
  }, []);

  /** The receiver's answer to "where did you get to", if one has arrived. */
  const takeResume = useCallback((requestId: string): number | null => {
    const asked = resumeRef.current;
    if (asked === null || asked.requestId !== requestId) return null;
    resumeRef.current = null;
    return asked.fromChunk;
  }, []);

  /**
   * Waits out a file channel that dropped part way through a song.
   *
   * Gives the channel up to a minute to come back; once it has, gives the
   * receiver ten seconds to say how much it holds. A channel that drops again
   * while waiting for that answer goes back to waiting for it to return, on the
   * same minute: the budget is for the whole outage, not for each gap in it.
   */
  const rejoin = useCallback(
    async (
      requestId: string,
    ): Promise<
      | { kind: "resume"; fromChunk: number }
      | { kind: "restart" }
      | { kind: "gone" }
    > => {
      const giveUpAt = Date.now() + REJOIN_WAIT_MS;
      for (;;) {
        while (!fileChannelOpen()) {
          if (Date.now() >= giveUpAt) return { kind: "gone" };
          await wait(REJOIN_POLL_MS);
        }
        const answerBy = Date.now() + RESUME_ANSWER_WAIT_MS;
        while (fileChannelOpen() && Date.now() < answerBy) {
          const fromChunk = takeResume(requestId);
          if (fromChunk !== null) return { kind: "resume", fromChunk };
          await wait(REJOIN_POLL_MS);
        }
        if (fileChannelOpen()) return { kind: "restart" };
      }
    },
    [fileChannelOpen, takeResume],
  );

  /**
   * Gives the file channel a chance to finish opening before concluding there
   * is nobody on the other end. The track is already loaded on this side, so
   * this is never fatal here -- but it is always worth saying, because the
   * consequence lands entirely on the other person's screen.
   */
  const waitForChannel = useCallback(async (): Promise<boolean> => {
    for (let waited = 0; !fileChannelOpen(); waited += BACKPRESSURE_WAIT_MS) {
      if (waited >= CHANNEL_OPEN_WAIT_MS) {
        setError(
          "The song is playing here, but it could not be sent to them — no file connection opened.",
        );
        return false;
      }
      await wait(BACKPRESSURE_WAIT_MS);
    }
    return true;
  }, [fileChannelOpen]);

  /** Sends the song over the call's own file channel. */
  const sendOverCall = useCallback(
    async (track: TrackToSend): Promise<SendOutcome> => {
      if (!(await waitForChannel())) return "no-peer";

      // An answer left over from some earlier transfer is not an answer to this.
      resumeRef.current = null;

      const announce = () => {
        sendMessage({
          t: "track-meta",
          requestId: track.requestId,
          title: track.title,
          durationSec: track.durationSec,
          bytes: track.media.byteLength,
          chunks: chunkCount(track.media.byteLength),
        });
      };
      announce();

      const chunks = chunkTrack(track.media);
      let kbps = paceKbps(linkSnapshot());
      let rateReadAt = Date.now();
      let sendAt = rateReadAt;
      let index = 0;

      /**
       * Carries on after the channel went away, or says it never came back.
       *
       * The receiver kept what it had, so if it answers the song continues from
       * the chunk it names. If it does not -- an older build, or a page that was
       * reloaded -- the song starts again from the beginning, announced afresh
       * so that whatever partial copy it holds is replaced rather than extended.
       */
      const recover = async (): Promise<boolean> => {
        const outcome = await rejoin(track.requestId);
        if (outcome.kind === "gone") {
          setError(
            "They dropped out part way through the song. Try loading it again.",
          );
          return false;
        }
        if (outcome.kind === "resume") {
          index = Math.min(outcome.fromChunk, chunks.length);
        } else {
          announce();
          index = 0;
        }
        // Time spent waiting is not credit to be repaid as a burst.
        sendAt = Date.now();
        return true;
      };

      while (index < chunks.length) {
        // The receiver may ask to carry on from an earlier chunk before this
        // side has noticed the channel was ever gone.
        const asked = takeResume(track.requestId);
        if (asked !== null) {
          index = Math.min(asked, chunks.length);
          sendAt = Date.now();
          continue;
        }

        const chunk = chunks[index];

        // The song gives way to the voice it shares the link with when the voice
        // is queueing up. No bytes move while it is, however long that is -- a
        // song that arrives late is fine, a call that breaks up is not.
        let link = linkSnapshot();
        let dropped = false;
        while (shouldHold(link)) {
          // A hold is not a reason to miss the other person leaving.
          if (!fileChannelOpen()) {
            dropped = true;
            break;
          }
          await wait(HOLD_POLL_MS);
          link = linkSnapshot();
        }
        if (dropped) {
          if (!(await recover())) return "peer-left";
          continue;
        }

        if (Date.now() - rateReadAt >= RATE_REFRESH_MS) {
          kbps = paceKbps(link);
          rateReadAt = Date.now();
        }

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
          // long as the page stayed open. A closed one is now waited out for a
          // bounded time, because a rebuilt call brings it back.
          if (!fileChannelOpen()) {
            dropped = true;
            break;
          }
          // A backstop for the case the channel is open but permanently
          // unwilling. Far longer than real backpressure, which clears in
          // milliseconds, and still finite.
          if (waited >= SEND_GIVE_UP_MS) {
            setError(
              "The song stopped going through to them. Try loading it again.",
            );
            return "stalled";
          }
          await wait(BACKPRESSURE_WAIT_MS);
          waited += BACKPRESSURE_WAIT_MS;
        }
        if (dropped) {
          if (!(await recover())) return "peer-left";
          continue;
        }

        index += 1;
        // Nothing follows the last chunk, so there is nothing to make room for.
        if (index >= chunks.length) break;

        // Spaces the chunks out to the paced rate. Each slot counts from the
        // previous one, so the time spent sending does not stretch the gaps --
        // but never from further back than now, so time lost to a hold or to
        // backpressure is not repaid afterwards as a burst.
        const now = Date.now();
        sendAt = Math.max(now, nextSendAt(sendAt, chunk.byteLength, kbps));
        if (sendAt > now) await wait(sendAt - now);
      }

      sendMessage({ t: "track-done", requestId: track.requestId });
      setError(null);
      return "sent";
    },
    [
      sendMessage,
      sendFileChunk,
      fileChannelOpen,
      linkSnapshot,
      waitForChannel,
      rejoin,
      takeResume,
    ],
  );

  /**
   * Leaves the song in the bucket and tells the other side where to fetch it.
   *
   * Null means the bucket was not usable -- no slot, or the upload failed --
   * and the caller sends the song over the call instead. Anything else is how
   * the send ended.
   */
  const sendViaBucket = useCallback(
    async (track: TrackToSend): Promise<SendOutcome | null> => {
      const api = bucketRef.current;
      const bytes = track.media.byteLength;
      const report = (sentBytes: number) => {
        sendMessage({
          t: "track-progress",
          requestId: track.requestId,
          sentBytes,
          bytes,
        });
      };

      let slot: TrackSlot | null = null;
      let uploaded = false;
      let lastReported = -1;
      let lastReportAt: number | null = null;
      try {
        slot = await api.requestTrackSlot(roomCodeRef.current, bytes);
        if (slot !== null) {
          uploaded = await api.uploadTrack(
            slot.uploadUrl,
            track.media,
            (sentBytes) => {
              // Upload progress arrives many times a second; the other person's
              // bar does not need that, and the control channel is shared with
              // playback position.
              const now = Date.now();
              if (
                lastReportAt !== null &&
                now - lastReportAt < PROGRESS_INTERVAL_MS
              ) {
                return;
              }
              lastReportAt = now;
              lastReported = sentBytes;
              report(sentBytes);
            },
          );
        }
      } catch {
        uploaded = false;
      }
      if (slot === null || !uploaded) return null;

      // The throttle may have swallowed the last report; the bar should reach
      // the halfway mark before the download takes over.
      if (lastReported !== bytes) report(bytes);

      // The link is useless to someone who is not there to follow it.
      if (!(await waitForChannel())) return "no-peer";

      sendMessage({
        t: "track-url",
        requestId: track.requestId,
        url: slot.downloadUrl,
        title: track.title,
        durationSec: track.durationSec,
        bytes,
      });
      // Kept until they confirm they could fetch it: if they cannot, the song
      // has to be sent the other way, and this is the only copy left to send.
      lastBucketTrackRef.current = track;
      setError(null);
      return "sent";
    },
    [sendMessage, waitForChannel],
  );

  const sendTrack = useCallback(
    async (track: TrackToSend): Promise<SendOutcome> => {
      // The camera is held for the whole send, whichever way it goes, and let go
      // however it ends: a camera left off after a failed send would look to the
      // other person exactly like a broken one.
      acquireCamera();
      try {
        const viaBucket = await sendViaBucket(track);
        if (viaBucket !== null) return viaBucket;
        return await sendOverCall(track);
      } finally {
        releaseCamera();
      }
    },
    [acquireCamera, releaseCamera, sendViaBucket, sendOverCall],
  );

  const handleMessage = useCallback(
    (message: PeerMessage) => {
      if (message.t === "track-meta") {
        stopWaiting();
        // A song arriving over the call replaces any download still running for
        // an earlier offer; both landing would hand the player the same song
        // twice.
        downloadGenRef.current += 1;
        downloadingRef.current = null;
        supersededRef.current.delete(message.requestId);
        noteRequest(message.requestId);
        channelWasOpenRef.current = null;
        assemblerRef.current = createAssembler(message.chunks, message.bytes);
        pendingRef.current = {
          title: message.title,
          durationSec: message.durationSec,
          requestId: message.requestId,
        };
        setError(null);
        setIncoming({ receivedBytes: 0, expectedBytes: message.bytes });
        return;
      }

      if (message.t === "track-progress") {
        if (!noteRequest(message.requestId)) return;
        // Already arriving some other way: the bar belongs to that.
        if (downloadingRef.current === message.requestId) return;
        if (pendingRef.current?.requestId === message.requestId) return;
        setError(null);
        // The upload is the first half of the bar; the download is the second.
        setIncoming({
          receivedBytes: Math.floor(message.sentBytes / 2),
          expectedBytes: message.bytes,
        });
        return;
      }

      if (message.t === "track-url") {
        if (!noteRequest(message.requestId)) return;
        if (downloadingRef.current === message.requestId) return;
        if (pendingRef.current?.requestId === message.requestId) return;
        startDownload(message);
        return;
      }

      if (message.t === "track-url-failed") {
        const kept = lastBucketTrackRef.current;
        if (kept === null || kept.requestId !== message.requestId) return;
        lastBucketTrackRef.current = null;
        // Held from here, not from inside the async function, so there is no
        // moment in between when the camera is free and a song is going out.
        acquireCamera();
        void (async () => {
          try {
            await sendOverCall(kept);
          } catch {
            setError(
              "The song could not be sent to them. Try loading it again.",
            );
          } finally {
            releaseCamera();
          }
        })();
        return;
      }

      if (message.t === "track-resume") {
        // Kept for the send loop to pick up, which may be waiting for it or may
        // not yet have noticed the channel went away.
        resumeRef.current = {
          requestId: message.requestId,
          fromChunk: message.fromChunk,
        };
        return;
      }

      if (message.t === "track-error") {
        stopWaiting();
        assemblerRef.current = null;
        pendingRef.current = null;
        setIncoming(null);
        setError(message.message);
        return;
      }

      if (message.t === "track-done") {
        // Says only that the sender has no more bytes to hand over -- not that
        // the ones already handed over have arrived. This message takes the
        // control channel while the song takes the file channel, and nothing
        // orders one against the other, so on a slow link it lands minutes ahead
        // of the bytes it is describing.
        //
        // Treating it as a verdict is what cost the other person the song: the
        // assembler was thrown away and every chunk that followed had nowhere to
        // go. All it does now is start the clock.
        if (assemblerRef.current !== null) {
          doneRef.current = true;
          waitForTheRest();
        }
      }
    },
    [
      stopWaiting,
      waitForTheRest,
      noteRequest,
      startDownload,
      acquireCamera,
      releaseCamera,
      sendOverCall,
    ],
  );

  return { incoming, error, handleMessage, sendTrack };
}
