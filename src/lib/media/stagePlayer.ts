/**
 * Which player belongs on the stage.
 *
 * Pulled out of the room's JSX because it got one case wrong in a way that was
 * invisible from the markup: the karaoke branch fell through to the YouTube
 * player whenever this side had no file of its own, without ever asking what
 * kind of song was playing. When the song is a file the other person fetched,
 * that put a YouTube player on screen and the sync layer promptly handed it the
 * shared id -- which for a local track is the song's TITLE. YouTube answered
 * the only way it can for an eleven-character id it does not recognise:
 * "Video unavailable".
 *
 * Written as data rather than markup so the whole cross product can be checked.
 */

export type StagePlayer =
  /** This side holds the file; show it. */
  | "local"
  /** A YouTube video both sides stream themselves. */
  | "youtube"
  /** The song is a file that has not arrived here yet. Show neither player. */
  | "waiting"
  /** Nothing to show. */
  | "none";

export interface StageInput {
  /** The activity currently on the stage, or null before one is chosen. */
  activity: string | null;
  /** What kind of thing the room agreed is playing, or null before anything is. */
  filmSource: "youtube" | "local" | null;
  /** Whether THIS side holds the media file. */
  hasFile: boolean;
}

export function stagePlayer({ activity, filmSource, hasFile }: StageInput): StagePlayer {
  if (activity === "karaoke") {
    if (hasFile) return "local";
    // The decisive line. A local song this side has not received yet must not
    // be handed to YouTube, which is what produced "Video unavailable" on the
    // receiving side while the sender saw the song play perfectly.
    if (filmSource === "local") return "waiting";
    return "youtube";
  }

  if (activity === "movie") {
    if (filmSource === "youtube") return "youtube";
    // A film is never sent between the two of you -- each side opens its own
    // copy -- so having no file here is a standing state rather than a wait for
    // bytes, and the panel is what asks for one.
    return hasFile ? "local" : "none";
  }

  return "none";
}
