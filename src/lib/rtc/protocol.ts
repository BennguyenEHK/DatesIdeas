export const MEME_IDS = ["heart", "peace", "thumbsUp", "smile"] as const;
export type MemeId = (typeof MEME_IDS)[number];

export function isMemeId(v: unknown): v is MemeId {
  return typeof v === "string" && (MEME_IDS as readonly string[]).includes(v);
}

export type PeerMessage =
  | { t: "hello"; identity: string; name: string }
  | { t: "ping"; t0: number }
  | { t: "pong"; t0: number; t1: number }
  | { t: "meme"; id: MemeId; showAt: number };

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
    default:
      return null;
  }
}
