/**
 * A look the two of you designed in CreateSpace, kept for the photo booth.
 *
 * The six built-in looks are data painted by code (themes.ts). A designed look
 * cannot be: it is a drawing. So it is kept as two pictures the exact size of
 * `stripLayout(shots)`, and the booth sandwiches the two of you between them:
 *
 *   backdrop  -- the paper, the white frame, and whatever sits BEHIND people in
 *                each photo window (an uploaded picture, or the default sky).
 *                Fully opaque.
 *   overlay   -- the pencil, brush, spray and stickers, drawn OVER people.
 *                Transparent everywhere nothing was drawn.
 *
 * Both are PNG and both are stored per pair, like the album, so the two
 * browsers in a call load the same look by id.
 */
import { isShotCount, type ShotCount } from "@/lib/photo/strip";

export interface CustomLook {
  id: string;
  name: string;
  shots: ShotCount;
  /** The caption band's lettering, `#rrggbb`. */
  ink: string;
  /** Signed, short-lived. */
  backdropUrl: string;
  /** Signed, short-lived. */
  overlayUrl: string;
  createdAt: string;
}

export const LOOK_NAME_MAX = 40;
/** Per layer. A 1080-wide four-shot strip as PNG sits well under this. */
export const LOOK_LAYER_MAX_BYTES = 8 * 1024 * 1024;
/** An uploaded background picture for the designer. */
export const LOOK_SOURCE_MAX_BYTES = 12 * 1024 * 1024;
export const LOOK_SOURCE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

const HEX = /^#[0-9a-f]{6}$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

/** An id as minted by the looks API: short, url-safe. */
export function isLookId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{6,40}$/.test(value);
}

export function isCustomLook(value: unknown): value is CustomLook {
  if (typeof value !== "object" || value === null) return false;
  const look = value as Record<string, unknown>;
  return (
    isLookId(look.id) &&
    typeof look.name === "string" &&
    look.name.length <= LOOK_NAME_MAX &&
    isShotCount(look.shots) &&
    isHexColor(look.ink) &&
    typeof look.backdropUrl === "string" &&
    typeof look.overlayUrl === "string" &&
    typeof look.createdAt === "string"
  );
}

/** A background picture uploaded into the designer, shared by storage key. */
export interface LookSource {
  key: string;
  /** Signed, short-lived. */
  url: string;
}

/**
 * The client API every screen uses. Implemented in `src/lib/looks/client.ts`
 * against the `/api/looks` routes; every call resolves, never throws.
 */
export interface LooksClient {
  list(): Promise<{ ok: true; looks: CustomLook[] } | { ok: false; error: string }>;
  save(input: {
    name: string;
    shots: ShotCount;
    ink: string;
    backdrop: Blob;
    overlay: Blob;
  }): Promise<{ ok: true; look: CustomLook } | { ok: false; error: string }>;
  remove(id: string): Promise<{ ok: boolean; error?: string }>;
  uploadSource(file: Blob): Promise<{ ok: true; source: LookSource } | { ok: false; error: string }>;
  /** A fresh signed link for a source key the other person uploaded. */
  sourceUrl(key: string): Promise<{ ok: true; source: LookSource } | { ok: false; error: string }>;
}
