import type { LinkSnapshot } from "@/lib/rtc/linkSnapshot";

/**
 * How the karaoke song shares the link with the call it rides on.
 *
 * The song goes over a data channel on the same connection as the voice and
 * video, and SCTP will take every bit the link offers. Sent flat out on a
 * 695 kbps relay it left the voice with 5% loss and nearly two seconds of
 * buffering, and the sync channel's ping sat fourteen seconds behind the file.
 * A slower download is a fair price; a broken voice is not.
 */

/** The slice of the outgoing estimate the song may use while the camera is on. */
export const TRANSFER_SHARE = 0.3;

/**
 * The slice the song may use while the camera is held off for it.
 *
 * With the picture stopped the link carries only the voice, so the share the
 * camera would have used is free, and the song is the only thing that wants it.
 */
export const TRANSFER_SHARE_CAMERA_PAUSED = 0.7;

/** Below this the song would take longer than anyone would wait for it. */
export const TRANSFER_MIN_KBPS = 48;

/** Above this the song is already quick, and more only crowds the call. */
export const TRANSFER_MAX_KBPS = 1500;

/**
 * The rate used before the browser has measured anything.
 *
 * Sized for a relay, because an unknown link is not a fast one. Guessing
 * "unlimited" here is exactly the flat-out send this module exists to stop.
 */
export const TRANSFER_UNKNOWN_KBPS = 160;

/**
 * Jitter on the voice, in ms, past which the song stops to let it recover.
 *
 * Jitter is a queue building up on the path, and that queue is what the song
 * itself fills when it sends too much, so it is the one signal that is ours to
 * answer.
 */
const HOLD_JITTER_MS = 400;

/** The rate the song may be sent at, in kbps, for what the link looks like now. */
export function paceKbps(link: LinkSnapshot): number {
  const outgoing = link.outgoingKbps;
  if (outgoing === null || !Number.isFinite(outgoing))
    return TRANSFER_UNKNOWN_KBPS;
  const share = link.cameraPaused
    ? TRANSFER_SHARE_CAMERA_PAUSED
    : TRANSFER_SHARE;
  return Math.min(
    TRANSFER_MAX_KBPS,
    Math.max(TRANSFER_MIN_KBPS, outgoing * share),
  );
}

function over(value: number | null, limit: number): boolean {
  return value !== null && value > limit;
}

/**
 * Whether the voice is suffering badly enough that the song should stop.
 *
 * Only jitter holds it. Loss alone never does: random Wi-Fi loss is not caused
 * by the song, so holding on it does not help the voice and only starves the
 * song. On a lossy link the old rule held the song nearly all the time, and it
 * went from 7% to 10% in three minutes. Jitter is different -- a queue building
 * up is what a song sent too fast produces -- so that is still worth yielding
 * to.
 *
 * The other side's report is preferred, because it describes the voice we are
 * sending, which is what the song competes with. Only when they have reported
 * nothing does our own reception stand in for it: the path is usually
 * congested both ways at once. An unknown figure never holds -- a missing
 * report must not stall the song forever.
 */
export function shouldHold(link: LinkSnapshot): boolean {
  if (over(link.theirJitterMs, HOLD_JITTER_MS)) return true;
  if (link.theirLossPct !== null || link.theirJitterMs !== null) return false;
  return over(link.audioJitterMs, HOLD_JITTER_MS);
}

/** How long one chunk of this size occupies the link at this rate, in ms. */
export function delayForChunkMs(bytes: number, kbps: number): number {
  // bits / (kbit/s) is ms. A rate of zero or less would be an infinite wait;
  // the floor on the rate is paceKbps's job, so here it only has to not break.
  if (!(kbps > 0)) return 1;
  return Math.max(1, (bytes * 8) / kbps);
}

/**
 * When the chunk after this one may go.
 *
 * Measured from the previous slot rather than from whenever the send loop got
 * round to it, so the time spent sending does not add to the gap. The caller
 * keeps the result from falling behind now: time spent held or backed up must
 * not become credit that is then spent as a burst.
 */
export function nextSendAt(
  previousAt: number,
  bytes: number,
  kbps: number,
): number {
  return previousAt + delayForChunkMs(bytes, kbps);
}
