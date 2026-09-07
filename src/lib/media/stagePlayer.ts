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
  /**
   * Whether a song has been asked for and has not arrived yet, on either side.
   *
   * Karaoke only, and separate from `hasFile` because it is true at a moment
   * when this side does hold a perfectly good file -- the PREVIOUS song. Left
   * on screen it is not merely stale: the transport is shared, so pressing play
   * over it starts one song here and a different one there.
   */
  songLoading?: boolean;
}

export function stagePlayer({
  activity,
  filmSource,
  hasFile,
  songLoading = false,
}: StageInput): StagePlayer {
  if (activity === "karaoke") {
    // Checked before `hasFile`, which at this moment is still answering for the
    // song being replaced.
    if (songLoading) return "waiting";
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

/**
 * Whether the song this browser is holding is the song the room is playing.
 *
 * `ready` alone answers a different question -- "is there a file here at all" --
 * and it stays true from the previous song forever. So when the other person
 * loaded a new one, their choice crossed the control channel immediately while
 * their bytes were still in flight, and this side went on showing, and playing,
 * the song before it. One shared play button then started two different songs.
 *
 * The id is the same string the room already agreed on as the film's id, so
 * there is nothing new to keep in step: either this side holds that song or it
 * is still waiting for it.
 */
export function holdsCurrentSong(
  held: { ready: boolean; id: string | null },
  filmId: string | null,
): boolean {
  if (!held.ready || held.id === null || filmId === null) return false;
  return held.id === filmId;
}

/**
 * Which side, if either, is still waiting on a song, and therefore why nobody
 * may touch the transport.
 *
 * Four separate things can mean "not yet", and they know different amounts, so
 * the order they are consulted in is the whole of this function.
 *
 * `sendingTo` is this side pushing bytes nobody has acknowledged. `receiving`
 * is bytes arriving here. `loading` is a fetch someone announced, and it is the
 * only one that remembers WHOSE machine is doing the work. `stage` knows merely
 * that this browser is not holding the song the room agreed on.
 *
 * The two that describe bytes actually moving come first, because they are the
 * later truth and they are the ones that can be measured -- the announcement
 * remains set underneath them until the song is in hand, and reading it first
 * would tell someone their own transfer was happening on the other computer and
 * hide the progress they can see filling.
 *
 * `loading` is still consulted before `stage`, because by the time the stage
 * has been forced to "waiting" the origin has been lost.
 */
export function songLanding({
  karaoke,
  stage,
  sendingTo,
  receiving,
  loading,
}: {
  karaoke: boolean;
  stage: StagePlayer;
  sendingTo: string | null;
  receiving: boolean;
  loading: "here" | "there" | null;
}): "here" | "there" | null {
  if (!karaoke) return null;
  if (sendingTo !== null) return "there";
  if (receiving) return "here";
  if (loading !== null) return loading;
  if (stage === "waiting") return "here";
  return null;
}
