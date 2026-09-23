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

/** The slice of the outgoing estimate the song may use. */
export const TRANSFER_SHARE = 0.3;

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

/** Loss on the voice, in percent, past which the song stops to let it recover. */
const HOLD_LOSS_PCT = 3;

/** Jitter on the voice, in ms, past which the song stops to let it recover. */
const HOLD_JITTER_MS = 400;

/** The rate the song may be sent at, in kbps, for what the link looks like now. */
export function paceKbps(link: LinkSnapshot): number {
  const outgoing = link.outgoingKbps;
  if (outgoing === null || !Number.isFinite(outgoing))
    return TRANSFER_UNKNOWN_KBPS;
  return Math.min(
    TRANSFER_MAX_KBPS,
    Math.max(TRANSFER_MIN_KBPS, outgoing * TRANSFER_SHARE),
  );
}

function over(value: number | null, limit: number): boolean {
  return value !== null && value > limit;
}

/**
 * Whether the voice is suffering badly enough that the song should stop.
 *
 * The other side's report is preferred, because it describes the voice we are
 * sending, which is what the song competes with. Only when they have reported
 * nothing does our own reception stand in for it: the path is usually
 * congested both ways at once. An unknown figure never holds -- a missing
 * report must not stall the song forever.
 */
export function shouldHold(link: LinkSnapshot): boolean {
  if (
    over(link.theirLossPct, HOLD_LOSS_PCT) ||
    over(link.theirJitterMs, HOLD_JITTER_MS)
  ) {
    return true;
  }
  if (link.theirLossPct !== null || link.theirJitterMs !== null) return false;
  return (
    over(link.audioLossPct, HOLD_LOSS_PCT) ||
    over(link.audioJitterMs, HOLD_JITTER_MS)
  );
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
