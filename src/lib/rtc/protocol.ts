import { isMood, type Mood } from "@/lib/cards/types";
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
      positionSec: number;
      playing: boolean;
      atSharedTime: number;
    };

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
            positionSec: m.positionSec,
            playing: m.playing,
            atSharedTime: m.atSharedTime,
          }
        : null;
    default:
      return null;
  }
}
