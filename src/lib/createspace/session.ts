/**
 * Where CreateSpace is, for both of you: which workshop is open and, in the
 * photo strip workshop, everything about the strip that is not a mark on it.
 *
 * Marks (strokes, stickers) travel as operations (ops.ts). This is the rest --
 * small, whole, and replaced rather than merged: every change sends the full
 * session stamped with the shared clock, and the later stamp wins. A tie goes
 * to the larger `by`, so two screens changing it at the same instant still
 * settle on the same one.
 */
import { isShotCount, type ShotCount } from "@/lib/photo/strip";
import { isHexColor } from "@/lib/looks/types";

export const WORKSHOPS = ["menu", "strip", "doodle"] as const;
export type Workshop = (typeof WORKSHOPS)[number];

export function isWorkshop(value: unknown): value is Workshop {
  return typeof value === "string" && (WORKSHOPS as readonly string[]).includes(value);
}

/**
 * `new` designs a look to keep for the booth. `edit` draws over the strip the
 * booth just developed and hands it back to the booth on save.
 */
export type StripMode = "new" | "edit";

/**
 * The background picture placed in the photo windows.
 *
 * `x` and `y` are the picture's centre as a fraction of one photo window, and
 * `scale` multiplies the size at which it would exactly cover the window. The
 * same placement is applied to every window, so a four-shot strip reads as one
 * scene repeated rather than four different crops.
 */
export interface Backdrop {
  key: string;
  x: number;
  y: number;
  scale: number;
}

export const BACKDROP_MIN_SCALE = 0.5;
export const BACKDROP_MAX_SCALE = 4;

export interface CreateSession {
  workshop: Workshop;
  mode: StripMode;
  shots: ShotCount;
  /** The strip's paper, `#rrggbb`. */
  paper: string;
  backdrop: Backdrop | null;
  /** Both cameras shown live inside the photo windows. */
  merge: boolean;
  /** Shared-clock ms. The later session wins. */
  at: number;
  /** Identity of whoever set it; breaks ties. */
  by: string;
}

export const DEFAULT_PAPER = "#ffffff";

export const MENU_SESSION: CreateSession = {
  workshop: "menu",
  mode: "new",
  shots: 1,
  paper: DEFAULT_PAPER,
  backdrop: null,
  merge: false,
  at: 0,
  by: "",
};

/** True when `next` should replace `current`. */
export function supersedes(next: CreateSession, current: CreateSession): boolean {
  return next.at > current.at || (next.at === current.at && next.by > current.by);
}

const isNum = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function isBackdrop(value: unknown): value is Backdrop {
  if (typeof value !== "object" || value === null) return false;
  const b = value as Record<string, unknown>;
  return (
    typeof b.key === "string" &&
    b.key.length > 0 &&
    b.key.length <= 200 &&
    isNum(b.x) &&
    b.x >= -2 &&
    b.x <= 3 &&
    isNum(b.y) &&
    b.y >= -2 &&
    b.y <= 3 &&
    isNum(b.scale) &&
    b.scale >= BACKDROP_MIN_SCALE &&
    b.scale <= BACKDROP_MAX_SCALE
  );
}

/** Runs on what the other browser sent. */
export function isCreateSession(value: unknown): value is CreateSession {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    isWorkshop(s.workshop) &&
    (s.mode === "new" || s.mode === "edit") &&
    isShotCount(s.shots) &&
    isHexColor(s.paper) &&
    (s.backdrop === null || isBackdrop(s.backdrop)) &&
    typeof s.merge === "boolean" &&
    isNum(s.at) &&
    typeof s.by === "string" &&
    s.by.length <= 64
  );
}
