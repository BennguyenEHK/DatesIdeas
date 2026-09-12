import { occurrencesIn, type BlockSeed } from "./recur";

/**
 * Deciding which reminders are due right now.
 *
 * Pure, so the rule can be tested without a clock or a database. The sweep that
 * calls it runs on a schedule nobody here controls precisely -- every five
 * minutes on a paid Vercel plan, once a day on the free one, whenever an outside
 * pinger gets round to it -- so this is written to be correct at ANY frequency
 * rather than assuming one.
 */

/**
 * How late a reminder may still go out.
 *
 * A sweep that runs a few minutes late should still send "starts in 30 minutes"
 * even if it is now 27. One that runs hours late must not: a reminder for
 * something already finished is not a reminder, it is noise.
 */
export const REMINDER_LOOKBACK_MS = 30 * 60 * 1000;

export interface ReminderCandidate extends BlockSeed {
  remindMinutes: number;
  /** The occurrence a reminder was last claimed for, or null. */
  remindedFor: string | null;
}

/**
 * The start instant of the occurrence whose reminder is due now, or null.
 *
 * Due means its send time -- start minus the lead -- has passed, but by no more
 * than the lookback, and nothing has been sent for it yet. Only occurrences
 * later than `remindedFor` qualify, which is what lets a weekly block remind
 * again next week without reminding twice this week.
 */
export function dueOccurrence(
  block: ReminderCandidate,
  now: Date,
  lookbackMs: number = REMINDER_LOOKBACK_MS,
): string | null {
  const leadMs = block.remindMinutes * 60 * 1000;
  const earliestStart = now.getTime() - lookbackMs + leadMs;
  const latestStart = now.getTime() + leadMs;

  const candidates = occurrencesIn(
    block,
    new Date(earliestStart),
    new Date(latestStart + 1),
    // The zone only labels civil days, which this does not read.
    "UTC",
  )
    // occurrencesIn reports anything that overlaps the window. A reminder cares
    // only about when an occurrence starts.
    .map((occurrence) => Date.parse(occurrence.startsAt))
    .filter((start) => start > earliestStart && start <= latestStart)
    .sort((left, right) => left - right);

  const lastSent = block.remindedFor === null ? null : Date.parse(block.remindedFor);
  const due = candidates.find((start) => lastSent === null || start > lastSent);
  return due === undefined ? null : new Date(due).toISOString();
}

/** The line a reminder says, phrased by lead time so it reads right in any zone. */
export function reminderBody(remindMinutes: number): string {
  if (remindMinutes <= 0) return "Starting now.";
  if (remindMinutes < 60) return `Starts in ${remindMinutes} minutes.`;
  if (remindMinutes === 60) return "Starts in an hour.";
  if (remindMinutes < 1440) return `Starts in ${Math.round(remindMinutes / 60)} hours.`;
  if (remindMinutes === 1440) return "Starts tomorrow, at this time.";
  return `Starts in ${Math.round(remindMinutes / 1440)} days.`;
}
