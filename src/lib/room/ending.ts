/**
 * How an evening ends.
 *
 * Deliberately not a confirmation dialog. A dialog would black out the film to
 * ask a question, which is the one thing this room never does -- every control
 * lives in the letterbox bars precisely so nothing covers the picture. Instead
 * the ending is announced and then waited out: five more minutes of the evening
 * you were already having, with the way back sitting next to the countdown.
 *
 * The phases are pure and live here rather than inside the hook so that both
 * sides run identical rules, and so the one transition that must not be
 * reversible can be stated once and tested.
 */

/**
 * How long the evening keeps going after somebody calls it.
 *
 * Long enough to say goodbye properly, which is the whole reason there is a
 * delay at all rather than an immediate exit.
 */
export const NOTICE_MS = 5 * 60 * 1000;

/**
 * The picture collapsing: a full frame down to a bright horizontal line, then
 * that line in to a point.
 *
 * Slow enough to read as a television being switched off rather than as the
 * page crashing, which at half the length is exactly how it looks.
 */
export const TV_OFF_MS = 900;

/** Pure black, held, before the homepage rises into it. */
export const DARK_HOLD_MS = 700;

export type EndingPhase =
  /** An ordinary evening. */
  | "none"
  /** Called, counting down, still cancellable. */
  | "counting"
  /** The picture is collapsing. Past the point of return. */
  | "closing"
  /** Black, on the way to the homepage. */
  | "dark";

export type EndingEvent =
  /** Somebody set, or cleared, the moment the evening ends. */
  | { kind: "set"; endsAt: number | null }
  /** The shared clock reached that moment. */
  | { kind: "reached" }
  /** The closing picture finished. */
  | { kind: "collapsed" };

/**
 * The next phase, given what just happened.
 *
 * `closing` and `dark` absorb everything. Both sides are mid-animation by then
 * and a message that revived the room would revive it on one screen and not the
 * other -- and a cancel arriving a half-second late is not rare, it is the
 * ordinary case for two people on a relayed connection.
 */
export function reduceEnding(phase: EndingPhase, event: EndingEvent): EndingPhase {
  if (phase === "closing") return event.kind === "collapsed" ? "dark" : "closing";
  if (phase === "dark") return "dark";

  if (event.kind === "set") return event.endsAt === null ? "none" : "counting";
  if (event.kind === "reached") return phase === "counting" ? "closing" : phase;
  return phase;
}

/**
 * Milliseconds left, floored at zero so nothing downstream counts backwards.
 *
 * Both arguments are shared-clock times rather than local ones. Two machines
 * disagree about what time it is by however far apart their clocks have
 * drifted, and a countdown measured locally would run out at two different
 * moments -- which for the last shared minutes of an evening is the one thing
 * it must not do.
 */
export function countdownLeft(endsAt: number | null, sharedNow: number): number {
  if (endsAt === null) return 0;
  return Math.max(0, endsAt - sharedNow);
}

/** The countdown as a clock, zero-padded so its width never jumps. */
export function formatCountdown(ms: number): string {
  const whole = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
