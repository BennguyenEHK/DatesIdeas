import {
  MUSIC_QUEUE_MAX,
  type MusicTrack,
  type PeerMessage,
} from "@/lib/rtc/protocol";

/**
 * Tonight's music queue, as both screens hold it.
 *
 * Whole state rather than edits, for the same reason the playback state is: a
 * dropped "remove" would leave the two lists disagreeing forever, while a
 * repeated whole list is harmless. `revision` counts local changes and
 * `sentAt` is the shared-clock instant of the change that produced this state;
 * together they decide whose list wins when both of you change it at once.
 */
export interface MusicState {
  queue: MusicTrack[];
  /** The track that is playing, or null when nothing has been chosen. */
  index: number | null;
  revision: number;
  sentAt: number;
}

export type MusicMessage = Extract<PeerMessage, { t: "music" }>;

export const EMPTY_MUSIC: MusicState = {
  queue: [],
  index: null,
  revision: 0,
  sentAt: 0,
};

/** The protocol refuses longer titles, so one this long never leaves here. */
const TITLE_MAX = 200;

/**
 * A new state carrying a change, with the revision moved on.
 *
 * Only ever called once something has actually changed. A revision that moved
 * without a change would win against the other screen's real edit and throw it
 * away for nothing.
 */
function changed(
  state: MusicState,
  queue: MusicTrack[],
  index: number | null,
): MusicState {
  return { ...state, queue, index, revision: state.revision + 1 };
}

/**
 * Appends tracks to the end of the queue.
 *
 * Starts the queue at the first track when nothing was chosen yet. Tracks past
 * the protocol's limit are dropped here, because the other side refuses a
 * longer list outright and would then hear none of it.
 */
export function addTracks(state: MusicState, tracks: MusicTrack[]): MusicState {
  const room = MUSIC_QUEUE_MAX - state.queue.length;
  const accepted = tracks.slice(0, Math.max(0, room));
  if (accepted.length === 0) return state;
  const queue = [...state.queue, ...accepted];
  return changed(state, queue, state.index ?? 0);
}

/**
 * Takes one track out of the queue.
 *
 * Removing a track before the playing one shifts the index back so the same
 * song stays current. Removing the playing track hands its place to the one
 * after it, or to the one before it when it was last.
 */
export function removeAt(state: MusicState, at: number): MusicState {
  if (!Number.isInteger(at) || at < 0 || at >= state.queue.length) return state;
  const queue = state.queue.filter((_, i) => i !== at);
  if (queue.length === 0) return changed(state, queue, null);

  let index = state.index;
  if (index !== null && at < index) index -= 1;
  else if (index !== null && index >= queue.length) index = queue.length - 1;
  return changed(state, queue, index);
}

export function jumpTo(state: MusicState, at: number): MusicState {
  if (!Number.isInteger(at) || at < 0 || at >= state.queue.length) return state;
  if (state.index === at) return state;
  return changed(state, state.queue, at);
}

/**
 * Moves to the following track, and stops at the end rather than wrapping.
 *
 * `from` is the track this move is meant to leave. When a song ends, both
 * screens notice and both ask to move on; whichever asks second finds the index
 * already past `from` and changes nothing, instead of skipping a song nobody
 * heard.
 */
export function next(
  state: MusicState,
  from: number | null = state.index,
): MusicState {
  if (state.index === null || state.index !== from) return state;
  if (state.index >= state.queue.length - 1) return state;
  return changed(state, state.queue, state.index + 1);
}

export function previous(state: MusicState): MusicState {
  if (state.index === null || state.index === 0) return state;
  return changed(state, state.queue, state.index - 1);
}

/**
 * Keeps the queue but plays nothing.
 *
 * For karaoke and the film, which take the shared player over. The list is
 * still there when you come back to the call; the music is not, until one of
 * you chooses to start it again.
 */
export function stop(state: MusicState): MusicState {
  if (state.index === null) return state;
  return changed(state, state.queue, null);
}

/**
 * Fills in titles that have been looked up, by video id.
 *
 * Only tracks still showing their id are touched: a title that already arrived
 * from the other screen is left as it is.
 */
export function setTitles(
  state: MusicState,
  titles: Record<string, string>,
): MusicState {
  let any = false;
  const queue = state.queue.map((track) => {
    const title = titles[track.videoId];
    if (track.title !== null || title === undefined || title === "")
      return track;
    any = true;
    return { ...track, title: title.slice(0, TITLE_MAX) };
  });
  return any ? changed(state, queue, state.index) : state;
}

/**
 * Which of two versions of the queue both screens should settle on.
 *
 * The higher revision has seen more changes and wins. On a tie -- both of you
 * changed it at once from the same starting point -- the later change wins, so
 * both screens pick the same one without talking about it. On a full tie the
 * two are the same message echoed back and the local copy is kept.
 */
export function acceptRemote(
  local: MusicState,
  incoming: MusicMessage,
): MusicState {
  const wins =
    incoming.revision > local.revision ||
    (incoming.revision === local.revision && incoming.sentAt > local.sentAt);
  if (!wins) return local;
  return {
    queue: incoming.queue,
    index: incoming.index,
    revision: incoming.revision,
    sentAt: incoming.sentAt,
  };
}

export function toMessage(state: MusicState, sentAt: number): MusicMessage {
  return {
    t: "music",
    queue: state.queue,
    index: state.index,
    revision: state.revision,
    sentAt,
  };
}

/** The track that is playing, if any. */
export function currentTrack(state: MusicState): MusicTrack | null {
  return state.index === null ? null : (state.queue[state.index] ?? null);
}
