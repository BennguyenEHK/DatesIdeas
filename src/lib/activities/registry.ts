export const ACTIVITY_IDS = ["cards", "karaoke", "movie", "photobooth"] as const;
export type ActivityId = (typeof ACTIVITY_IDS)[number];

/**
 * How an activity wants the stage.
 *
 * `companion` keeps both faces full size and puts the activity in the band
 * beneath them. `takeover` gives the activity the stage and moves the faces
 * to a column beside it — still real tiles, so gesture memes keep landing on
 * them exactly as they do everywhere else.
 */
export type ActivityKind = "companion" | "takeover";

export interface ActivityDef {
  id: ActivityId;
  label: string;
  /** The bubble. */
  icon: string;
  kind: ActivityKind;
  /** False until the activity itself exists. The bubble shows, dimmed. */
  ready: boolean;
}

export const ACTIVITIES: readonly ActivityDef[] = [
  { id: "cards", label: "Card game", icon: "🎴", kind: "companion", ready: true },
  // Takeover, like the movie: the song needs the frame, and the faces move to
  // a column beside it so you can still see each other sing.
  { id: "karaoke", label: "Karaoke", icon: "🎤", kind: "takeover", ready: true },
  { id: "movie", label: "Movie", icon: "🎬", kind: "takeover", ready: true },
  // Takeover: the scene the two of you stand in IS the stage, with the strip
  // developing in the column beside it.
  { id: "photobooth", label: "Photo booth", icon: "📸", kind: "takeover", ready: true },
];

export function isActivityId(v: unknown): v is ActivityId {
  return typeof v === "string" && (ACTIVITY_IDS as readonly string[]).includes(v);
}

export function activity(id: ActivityId): ActivityDef {
  const found = ACTIVITIES.find((a) => a.id === id);
  if (!found) throw new Error(`unknown activity: ${id}`);
  return found;
}

/** Stable numeric key for the swap tie-break; declaration order is fine. */
export function activityKey(id: ActivityId): number {
  return ACTIVITY_IDS.indexOf(id);
}
