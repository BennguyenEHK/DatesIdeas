/**
 * CreateSpace: two people drawing on one picture, from two browsers.
 *
 * The hard part is not drawing, it is agreement. Each side paints its own
 * strokes immediately and hears about the other's a moment later, so the two
 * screens receive the same edits in different orders. If the scene were simply
 * "items in the order they arrived", the two pictures would disagree about what
 * sits on top of what, and nothing would ever notice.
 *
 * So the scene is ordered by a shared timestamp with an id to break ties, and
 * every operation is idempotent by id. Apply the same set of operations in any
 * order, any number of times, and both screens hold the same picture. That
 * property is what the tests in ops.test.ts exist to hold down.
 *
 * Coordinates are fractions of the picture, 0 to 1, never pixels. A laptop and
 * a phone draw the same stroke at different sizes, and only a normalised point
 * lands in the same place on both.
 */

/** The inks, taken from the app's own palette so a drawing belongs to the room. */
export const INKS = [
  "#f5efe0", // cream
  "#e8b94a", // lamp
  "#f2c230", // dress
  "#c74b6d", // neon
  "#a8b2d8", // mist
  "#131a38", // night
] as const;
export type Ink = (typeof INKS)[number];

export const STICKERS = ["❤️", "✨", "⭐", "🌙", "🎬", "🎵", "🌹", "😘", "🥂", "🎈", "👑", "💌"] as const;
export type Glyph = (typeof STICKERS)[number];

/** Enough for a long flourish; small enough that one stroke fits one message. */
export const MAX_POINTS = 600;
/** A ceiling on the whole scene, so a runaway sender cannot exhaust memory. */
export const MAX_ITEMS = 2000;

export const MIN_WIDTH = 0.002;
export const MAX_WIDTH = 0.05;
export const MIN_SCALE = 0.3;
export const MAX_SCALE = 4;

export type Point = readonly [number, number];

export interface Stroke {
  id: string;
  author: string;
  /** Shared-clock milliseconds. What orders the scene. */
  at: number;
  ink: Ink;
  /** A fraction of the picture's width. */
  width: number;
  points: readonly Point[];
}

export interface Sticker {
  id: string;
  author: string;
  at: number;
  glyph: Glyph;
  x: number;
  y: number;
  scale: number;
  /** Degrees. */
  rotation: number;
}

export type SceneItem = ({ type: "stroke" } & Stroke) | ({ type: "sticker" } & Sticker);

export type CanvasOp =
  | { kind: "stroke"; stroke: Stroke }
  /** Adds a sticker, or moves one that already exists with the same id. */
  | { kind: "sticker"; sticker: Sticker }
  /** Undo, or deleting one item. Names its target, so both sides remove the same one. */
  | { kind: "remove"; id: string }
  | { kind: "clear" };

export interface Scene {
  items: readonly SceneItem[];
}

export const EMPTY_SCENE: Scene = { items: [] };

function before(a: { at: number; id: string }, b: { at: number; id: string }): boolean {
  return a.at < b.at || (a.at === b.at && a.id < b.id);
}

/** Inserts keeping the (at, id) order, which is the whole agreement mechanism. */
function insertOrdered(items: readonly SceneItem[], item: SceneItem): SceneItem[] {
  const next = items.slice();
  let index = next.length;
  while (index > 0 && before(item, next[index - 1])) index -= 1;
  next.splice(index, 0, item);
  return next;
}

/**
 * Applies one operation. Pure, and idempotent: applying the same operation twice
 * leaves the scene exactly as applying it once did.
 */
export function applyOp(scene: Scene, op: CanvasOp): Scene {
  switch (op.kind) {
    case "clear":
      return EMPTY_SCENE;

    case "remove": {
      const items = scene.items.filter((item) => item.id !== op.id);
      return items.length === scene.items.length ? scene : { items };
    }

    case "stroke": {
      // A stroke never changes after it is drawn, so a second copy is a
      // duplicate delivery and nothing more.
      if (scene.items.some((item) => item.id === op.stroke.id)) return scene;
      if (scene.items.length >= MAX_ITEMS) return scene;
      return { items: insertOrdered(scene.items, { type: "stroke", ...op.stroke }) };
    }

    case "sticker": {
      const existing = scene.items.find((item) => item.id === op.sticker.id);
      if (existing === undefined) {
        if (scene.items.length >= MAX_ITEMS) return scene;
        return { items: insertOrdered(scene.items, { type: "sticker", ...op.sticker }) };
      }
      if (existing.type !== "sticker") return scene;
      // A move keeps the sticker's original place in the stack. Taking the new
      // timestamp would lift a sticker above everything drawn since it was
      // placed every time somebody nudged it, and the two sides would disagree
      // about when the nudge happened.
      const moved: SceneItem = { ...existing, ...op.sticker, type: "sticker", at: existing.at };
      return { items: scene.items.map((item) => (item.id === moved.id ? moved : item)) };
    }
  }
}

/** Replays a list of operations from empty. */
export function replay(ops: readonly CanvasOp[]): Scene {
  return ops.reduce(applyOp, EMPTY_SCENE);
}

/**
 * The item this person would undo: their own most recent one.
 *
 * Only ever your own. Undo taking back the other person's last stroke would be
 * the fastest way to make drawing together feel like a fight.
 */
export function undoTarget(scene: Scene, author: string): string | null {
  for (let index = scene.items.length - 1; index >= 0; index -= 1) {
    if (scene.items[index].author === author) return scene.items[index].id;
  }
  return null;
}

/** Four decimal places: a ten-thousandth of the picture, far finer than a pixel. */
export function quantize(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Drops points too close to the previous one to matter.
 *
 * A pointer fires far faster than anybody's hand moves, and every point sent is
 * bytes on a channel that also carries the call. This keeps the shape and loses
 * the jitter.
 */
export function thin(points: readonly Point[], minDistance = 0.002): Point[] {
  const kept: Point[] = [];
  for (const point of points) {
    const last = kept[kept.length - 1];
    if (last === undefined || Math.hypot(point[0] - last[0], point[1] - last[1]) >= minDistance) {
      kept.push([quantize(point[0]), quantize(point[1])]);
    }
  }
  return kept;
}

// ---------------------------------------------------------------- validation
//
// Everything below runs on what the OTHER browser sent. The data channel is a
// trusted peer in the ordinary case, but a malformed frame must never reach the
// canvas, and a hostile one must not be able to hang it.

const isNum = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isShortString = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;

/** Slightly outside 0..1 is allowed: a stroke dragged off the edge is still a stroke. */
const inPicture = (value: unknown): value is number => isNum(value) && value >= -0.1 && value <= 1.1;

export function isInk(value: unknown): value is Ink {
  return typeof value === "string" && (INKS as readonly string[]).includes(value);
}

export function isGlyph(value: unknown): value is Glyph {
  return typeof value === "string" && (STICKERS as readonly string[]).includes(value);
}

function isStroke(value: unknown): value is Stroke {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    isShortString(s.id, 40) &&
    isShortString(s.author, 64) &&
    isNum(s.at) &&
    isInk(s.ink) &&
    isNum(s.width) &&
    s.width >= MIN_WIDTH &&
    s.width <= MAX_WIDTH &&
    Array.isArray(s.points) &&
    s.points.length >= 1 &&
    s.points.length <= MAX_POINTS &&
    s.points.every(
      (point) => Array.isArray(point) && point.length === 2 && inPicture(point[0]) && inPicture(point[1]),
    )
  );
}

function isSticker(value: unknown): value is Sticker {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    isShortString(s.id, 40) &&
    isShortString(s.author, 64) &&
    isNum(s.at) &&
    isGlyph(s.glyph) &&
    inPicture(s.x) &&
    inPicture(s.y) &&
    isNum(s.scale) &&
    s.scale >= MIN_SCALE &&
    s.scale <= MAX_SCALE &&
    isNum(s.rotation) &&
    s.rotation >= -180 &&
    s.rotation <= 180
  );
}

export function isCanvasOp(value: unknown): value is CanvasOp {
  if (typeof value !== "object" || value === null) return false;
  const op = value as Record<string, unknown>;
  switch (op.kind) {
    case "clear":
      return true;
    case "remove":
      return isShortString(op.id, 40);
    case "stroke":
      return isStroke(op.stroke);
    case "sticker":
      return isSticker(op.sticker);
    default:
      return false;
  }
}

/** A short id, unique enough across two browsers and one evening. */
export function newItemId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
