/**
 * What the link can carry right now, and how the voice is faring on it.
 *
 * Read by anything that wants to send bulk data across the same connection
 * the call is using -- today, the karaoke song. A song pushed as fast as the
 * channel accepts it takes every bit the link has: on a 700 kbps relay it
 * left the voice with 5% loss, seconds of buffering, and a fourteen-second
 * ping queued behind a megabyte of file. This is the figure that stops that.
 *
 * All fields are null until the first stats poll has measured them. A null
 * means "unknown", never "unlimited".
 */
export interface LinkSnapshot {
  /** The browser's estimate of what this side can send, in kbps. */
  outgoingKbps: number | null;
  /** How long this side is holding the other person's voice back, ms. */
  audioJitterMs: number | null;
  /** Loss on the voice arriving here, percent 0-100, over the last window. */
  audioLossPct: number | null;
  /** What the other side reports about the voice we send them: jitter, ms. */
  theirJitterMs: number | null;
  /** And its loss, percent 0-100. */
  theirLossPct: number | null;
  /** Whether media is crossing a TURN relay. */
  relayed: boolean | null;
}

export const EMPTY_LINK: LinkSnapshot = {
  outgoingKbps: null,
  audioJitterMs: null,
  audioLossPct: null,
  theirJitterMs: null,
  theirLossPct: null,
  relayed: null,
};
