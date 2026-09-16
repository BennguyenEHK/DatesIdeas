import type { PeerMessage } from "@/lib/rtc/protocol";
import type { ActivityId } from "./registry";

/** The activity this side last settled on, and the shared instant it took effect. */
export interface ChosenActivity {
  id: ActivityId | null;
  showAt: number;
}

/**
 * What to tell a peer who has just arrived about the activity on this screen.
 *
 * Choosing an activity is announced once, at the moment it is chosen, over a
 * channel that silently drops anything sent while it is not open. So a person
 * who joins, reloads or reconnects after the album was opened never hears
 * about it: one screen shows the album and the other the call. Repeating the
 * choice on their arrival closes that gap.
 *
 * The original showAt is kept rather than restamped, so the usual swap rule
 * still settles it: the newer choice wins on both sides, and a repeat of what
 * they already have is ignored. Null means this side has never chosen
 * anything, and has nothing to say -- sending "closed" would pull someone who
 * is already in the album back out of it.
 */
export function activityAnnouncement(
  chosen: ChosenActivity | null,
): Extract<PeerMessage, { t: "activity" }> | null {
  if (chosen === null) return null;
  return { t: "activity", id: chosen.id, showAt: chosen.showAt };
}
