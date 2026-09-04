import { isMood, type Mood } from "@/lib/cards/types";
import { isThemeId, type ThemeId } from "@/lib/photo/themes";
import { SHOT_COUNTS, type ShotCount } from "@/lib/photo/strip";
import { isActivityId, type ActivityId } from "@/lib/activities/registry";

export const MEME_IDS = [
  "heart",
  "peace",
  "thumbsUp",
  "smile",
  "blowKiss",
  "handsOverMouth",
  "wink",
  "pray",
  "thumbsDown",
] as const;
export type MemeId = (typeof MEME_IDS)[number];

export function isMemeId(v: unknown): v is MemeId {
  return typeof v === "string" && (MEME_IDS as readonly string[]).includes(v);
}

/**
 * Where a film is coming from.
 *
 * "local" means each side opened its own copy from its own machine. The file
 * never travels — a feature film is gigabytes and this connection carries a
 * few hundred kilobytes a second — so all that is shared is the position, and
 * the length, which is the only way to notice you opened different files.
 */
export const PLAYBACK_SOURCES = ["youtube", "local"] as const;
export type PlaybackSource = (typeof PLAYBACK_SOURCES)[number];

export function isPlaybackSource(v: unknown): v is PlaybackSource {
  return typeof v === "string" && (PLAYBACK_SOURCES as readonly string[]).includes(v);
}

export type PeerMessage =
  | { t: "hello"; identity: string; name: string }
  | { t: "ping"; t0: number }
  | { t: "pong"; t0: number; t1: number }
  | { t: "meme"; id: MemeId; showAt: number }
  // The text rides along with the id. The id is what both sides track so a
  // question is not drawn twice; the text means a peer whose deck fetch
  // failed still shows the question instead of a blank card.
  | { t: "card"; cardId: number; text: string; mood: Mood; showAt: number }
  // Which activity both screens are on. Shared, so an evening moves together.
  // `null` closes the activity and returns to plain video.
  | { t: "activity"; id: ActivityId | null; showAt: number }
  // Whole playback state rather than play/pause/seek events. A dropped event
  // would leave the two players disagreeing forever with nothing to notice it;
  // a repeated state is harmless and heals the disagreement by itself.
  | {
      t: "media";
      videoId: string | null;
      source: PlaybackSource;
      /** Null for YouTube, where both sides fetch the same id and cannot
       *  disagree, and until a local file has reported its metadata. */
      durationSec: number | null;
      positionSec: number;
      playing: boolean;
      atSharedTime: number;
    }
  // A photo booth sitting. Only the instant it starts travels: both sides
  // derive the identical countdown and the identical flashes from it, and each
  // builds the strip from the two video feeds it already has. No picture ever
  // crosses the connection.
  | { t: "photo"; themeId: ThemeId; shots: ShotCount; startAt: number }
  // Whether someone is singing into this side's microphone right now.
  //
  // Delaying your music to catch up with their voice only ever works for the
  // listener. Two equal delays cancel exactly -- each side hears the other at
  // the same distance it started at -- so the pair of you cannot both be
  // accommodating at once. This message is what decides whose turn it is:
  // whoever is singing stays on the beat, and the one listening moves.
  | { t: "singing"; on: boolean }
  | { t: "track-request"; url: string; requestId: string }
  // Lyrics ride with the transfer plan because their small text payload does
  // not justify competing with the audio bytes on the file channel. `null`
  // remains meaningful: the track can play when no timed lyrics were found.
  | {
      t: "track-meta";
      requestId: string;
      title: string;
      durationSec: number;
      bytes: number;
      chunks: number;
      lrc: string | null;
    }
  | { t: "track-done"; requestId: string }
  | { t: "track-error"; requestId: string; message: string };

export function encode(m: PeerMessage): string {
  return JSON.stringify(m);
}

const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";

/**
 * Parses an inbound DataChannel payload. Returns null rather than throwing:
 * a malformed frame from the peer must never take down the session.
 */
export function decode(raw: string): PeerMessage | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const m = v as Record<string, unknown>;

  switch (m.t) {
    case "hello":
      return isStr(m.identity) && isStr(m.name)
        ? { t: "hello", identity: m.identity, name: m.name }
        : null;
    case "ping":
      return isNum(m.t0) ? { t: "ping", t0: m.t0 } : null;
    case "pong":
      return isNum(m.t0) && isNum(m.t1)
        ? { t: "pong", t0: m.t0, t1: m.t1 }
        : null;
    case "meme":
      return isMemeId(m.id) && isNum(m.showAt)
        ? { t: "meme", id: m.id, showAt: m.showAt }
        : null;
    case "card":
      return isNum(m.cardId) && isStr(m.text) && isMood(m.mood) && isNum(m.showAt)
        ? {
            t: "card",
            cardId: m.cardId,
            text: m.text,
            mood: m.mood,
            showAt: m.showAt,
          }
        : null;
    case "activity":
      return (m.id === null || isActivityId(m.id)) && isNum(m.showAt)
        ? { t: "activity", id: m.id as ActivityId | null, showAt: m.showAt }
        : null;
    case "media":
      return isNum(m.positionSec) &&
        typeof m.playing === "boolean" &&
        isNum(m.atSharedTime) &&
        (m.videoId === null || isStr(m.videoId))
        ? {
            t: "media",
            videoId: m.videoId as string | null,
            // Both fall back rather than rejecting the message: a peer running
            // the build before these existed sends neither, and karaoke
            // between two versions has to keep working.
            source: isPlaybackSource(m.source) ? m.source : "youtube",
            durationSec: isNum(m.durationSec) ? m.durationSec : null,
            positionSec: m.positionSec,
            playing: m.playing,
            atSharedTime: m.atSharedTime,
          }
        : null;
    case "photo":
      return isThemeId(m.themeId) &&
        isNum(m.shots) &&
        (SHOT_COUNTS as readonly number[]).includes(m.shots) &&
        isNum(m.startAt)
        ? {
            t: "photo",
            themeId: m.themeId,
            shots: m.shots as ShotCount,
            startAt: m.startAt,
          }
        : null;
    case "singing":
      return typeof m.on === "boolean" ? { t: "singing", on: m.on } : null;
    case "track-request":
      return isStr(m.url) && isStr(m.requestId)
        ? { t: "track-request", url: m.url, requestId: m.requestId }
        : null;
    case "track-meta":
      return isStr(m.requestId) &&
        isStr(m.title) &&
        isNum(m.durationSec) &&
        isNum(m.bytes) &&
        m.bytes >= 0 &&
        isNum(m.chunks) &&
        m.chunks >= 1 &&
        (m.lrc === null || isStr(m.lrc))
        ? {
            t: "track-meta",
            requestId: m.requestId,
            title: m.title,
            durationSec: m.durationSec,
            bytes: m.bytes,
            chunks: m.chunks,
            lrc: m.lrc,
          }
        : null;
    case "track-done":
      return isStr(m.requestId) ? { t: "track-done", requestId: m.requestId } : null;
    case "track-error":
      return isStr(m.requestId) && isStr(m.message)
        ? { t: "track-error", requestId: m.requestId, message: m.message }
        : null;
    default:
      return null;
  }
}
