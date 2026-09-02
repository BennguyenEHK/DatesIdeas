import { isValidRoomCode } from "./code";
import type { RoomStatus } from "./lifetime";

export interface RoomInfo {
  status: RoomStatus;
  expiresAt: string | null;
}

const STATUSES: readonly string[] = ["open", "expired", "missing"];

/**
 * Open a new room.
 *
 * The code comes from the server, which mints and claims it in one statement.
 * Returns null on any failure, because the alternative — navigating to a room
 * that was never created — strands you on a page waiting for a peer who cannot
 * arrive, with nothing on screen to explain why.
 */
export async function createRoom(): Promise<{
  code: string;
  expiresAt: string | null;
} | null> {
  try {
    const res = await fetch("/api/rooms", { method: "POST" });
    if (!res.ok) return null;
    const body = (await res.json()) as { code?: unknown; expiresAt?: unknown };
    // The code goes straight into a URL. Check it even though we asked for it.
    if (typeof body.code !== "string" || !isValidRoomCode(body.code)) return null;
    return {
      code: body.code.toUpperCase(),
      expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : null,
    };
  } catch {
    return null;
  }
}

/**
 * Ask whether a code can still be joined.
 *
 * This fails *open* on purpose, which is the opposite of the signalling gate.
 * That gate is the real one and refuses anything it cannot confirm; this is
 * only what the page says, and shutting two people out of a working room over
 * one dropped request would be the worse mistake.
 */
export async function fetchRoomStatus(code: string): Promise<RoomInfo> {
  try {
    const res = await fetch(`/api/rooms?code=${encodeURIComponent(code)}`);
    if (!res.ok) return { status: "open", expiresAt: null };
    const body = (await res.json()) as { status?: unknown; expiresAt?: unknown };
    if (typeof body.status !== "string" || !STATUSES.includes(body.status)) {
      return { status: "open", expiresAt: null };
    }
    return {
      status: body.status as RoomStatus,
      expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : null,
    };
  } catch {
    return { status: "open", expiresAt: null };
  }
}
