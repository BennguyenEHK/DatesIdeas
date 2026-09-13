export const ACTIVITY_IDS = [
  "cards",
  "karaoke",
  "movie",
  "photobooth",
  "createspace",
  "gameword",
  "album",
  "calendar",
] as const;
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
  /**
   * False for an activity opened from its own mark in the top bar rather than
   * from the row of bubbles. Missing means true.
   */
  bubble?: boolean;
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
  // Takeover: the picture being drawn on needs the frame, and the faces stay in
  // the column beside it so you can watch each other make it.
  { id: "createspace", label: "CreateSpace", icon: "🎨", kind: "takeover", ready: true },
  // Takeover, for the board. Appended rather than inserted: activityKey is the
  // index in ACTIVITY_IDS and breaks swap ties, so reordering would change the
  // tie-break between two builds of the app talking to each other.
  { id: "gameword", label: "GameWord", icon: "🎲", kind: "takeover", ready: true },
  // Takeover, both of them, so the two of you look through the album or plan
  // the week with your faces in the column beside it. Opened from their own
  // marks beside the wordmark, where they have always lived, not from bubbles.
  { id: "album", label: "Our album", icon: "📖", kind: "takeover", ready: true, bubble: false },
  { id: "calendar", label: "Our calendar", icon: "📅", kind: "takeover", ready: true, bubble: false },
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
