/**
 * The Lookbook's shared shapes: what a piece of clothing and an outfit are,
 * on the wire and on screen, and the checks every layer applies to them.
 *
 * One definition for the server, the client, the peer messages and the UI,
 * because each of them receives these from somewhere it does not trust --
 * a request body, a response, the other browser -- and four copies of the
 * rules would drift. See docs/superpowers/specs/2026-09-27-lookbook-design.md.
 */

/** What a piece is, picked with one tap. The order is the wardrobe's order. */
export const PIECE_KINDS = [
  "top",
  "bottom",
  "dress",
  "outerwear",
  "shoes",
  "bag",
  "accessory",
  "other",
] as const;
export type PieceKind = (typeof PIECE_KINDS)[number];

export const PIECE_CAP = 200;
export const OUTFIT_CAP = 100;
/** The most pieces one board holds. */
export const LAYOUT_MAX = 20;
export const PIECE_LABEL_MAX = 60;
export const OUTFIT_NAME_MAX = 40;
export const OUTFIT_NOTE_MAX = 280;
/** Before shrinking in the browser; a shrunk photo is far smaller. */
export const PIECE_SOURCE_MAX_BYTES = 12 * 1024 * 1024;
export const PIECE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type PieceContentType = (typeof PIECE_CONTENT_TYPES)[number];
/** The identity strings a hello carries; long enough for any of ours. */
export const PERSON_MAX = 64;
/** Board scale: a piece can shrink to a fifth or grow to twice its default. */
export const SCALE_MIN = 0.2;
export const SCALE_MAX = 2;

/** A piece of clothing, as the client sees it. */
export interface LookbookPiece {
  id: string;
  kind: PieceKind;
  /** Empty when none was given. */
  label: string;
  /** The identity of whoever added it, compared with ours to say "yours". */
  addedBy: string;
  /** Signed, short-lived. */
  url: string;
  createdAt: string;
}

/**
 * One piece on a board. `x` and `y` are the piece's centre as a fraction of
 * the board (0-1), so a phone and a laptop agree on where it sits; `scale`
 * is relative to the piece's default size; `z` stacks higher on top.
 */
export interface Placement {
  pieceId: string;
  x: number;
  y: number;
  scale: number;
  z: number;
}

export interface Outfit {
  id: string;
  name: string;
  /** `YYYY-MM-DD`, or null when it has no day yet. */
  wearOn: string | null;
  note: string;
  createdBy: string;
  /** Identities of whoever hearted it. */
  lovedBy: string[];
  layout: Placement[];
  createdAt: string;
  updatedAt: string;
}

const ID = /^[A-Za-z0-9_-]{6,40}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isLookbookId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

export function isPieceKind(value: unknown): value is PieceKind {
  return (PIECE_KINDS as readonly unknown[]).includes(value);
}

export function isPieceContentType(value: unknown): value is PieceContentType {
  return (PIECE_CONTENT_TYPES as readonly unknown[]).includes(value);
}

export function isPerson(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= PERSON_MAX;
}

/** A real calendar day, not merely the right shape: 2026-02-30 is refused. */
export function isWearOn(value: unknown): value is string {
  if (typeof value !== "string" || !DAY.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function fraction(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function isPlacement(value: unknown): value is Placement {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    isLookbookId(p.pieceId) &&
    fraction(p.x) &&
    fraction(p.y) &&
    typeof p.scale === "number" &&
    Number.isFinite(p.scale) &&
    p.scale >= SCALE_MIN &&
    p.scale <= SCALE_MAX &&
    typeof p.z === "number" &&
    Number.isSafeInteger(p.z) &&
    p.z >= 0
  );
}

/** A board: valid placements, each piece at most once, no more than LAYOUT_MAX. */
export function isLayout(value: unknown): value is Placement[] {
  if (!Array.isArray(value) || value.length > LAYOUT_MAX) return false;
  const seen = new Set<string>();
  for (const place of value) {
    if (!isPlacement(place) || seen.has(place.pieceId)) return false;
    seen.add(place.pieceId);
  }
  return true;
}

export function isPieceLabel(value: unknown): value is string {
  return typeof value === "string" && value.length <= PIECE_LABEL_MAX;
}

export function isOutfitName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.length <= OUTFIT_NAME_MAX;
}

export function isOutfitNote(value: unknown): value is string {
  return typeof value === "string" && value.length <= OUTFIT_NOTE_MAX;
}

export function isLookbookPiece(value: unknown): value is LookbookPiece {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    isLookbookId(p.id) &&
    isPieceKind(p.kind) &&
    isPieceLabel(p.label) &&
    isPerson(p.addedBy) &&
    typeof p.url === "string" &&
    p.url.length > 0 &&
    typeof p.createdAt === "string"
  );
}

export function isOutfit(value: unknown): value is Outfit {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  return (
    isLookbookId(o.id) &&
    isOutfitName(o.name) &&
    (o.wearOn === null || isWearOn(o.wearOn)) &&
    isOutfitNote(o.note) &&
    isPerson(o.createdBy) &&
    Array.isArray(o.lovedBy) &&
    o.lovedBy.every(isPerson) &&
    isLayout(o.layout) &&
    typeof o.createdAt === "string" &&
    typeof o.updatedAt === "string"
  );
}

/**
 * The HTTP contract, as the client library and the routes both see it.
 * Every route answers 401 without a season ticket and `{ error }` on failure.
 */
export interface PieceUploadRequest {
  contentType: PieceContentType;
  bytes: number;
}
export interface PieceUploadGrant {
  id: string;
  key: string;
  uploadUrl: string;
  receipt: string;
}
export interface PieceConfirm {
  id: string;
  key: string;
  contentType: PieceContentType;
  bytes: number;
  kind: PieceKind;
  label: string;
  addedBy: string;
  receipt: string;
}
export interface PiecePatch {
  kind?: PieceKind;
  label?: string;
}
export interface NewOutfit {
  name: string;
  createdBy: string;
  wearOn?: string | null;
  note?: string;
}
export interface OutfitPatch {
  name?: string;
  wearOn?: string | null;
  note?: string;
  layout?: Placement[];
  /** Heart or un-heart, by one person. */
  love?: { by: string; on: boolean };
}
