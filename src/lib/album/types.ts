/**
 * The shared vocabulary of the album. Pure types and predicates: no database,
 * no DOM, no network. Everything else in `src/lib/album` and every component
 * that draws the reel imports its nouns from here.
 */

/**
 * What an album item is.
 *
 * `strip` and `clip` are what the photo booth already produces, named to match
 * `KeepsakeKind` so a keepsake can move into the album without translation.
 * `photo` and `video` arrive from a phone. `recording` is a saved call.
 */
export const ALBUM_KINDS = ["strip", "clip", "photo", "video", "recording"] as const;
export type AlbumKind = (typeof ALBUM_KINDS)[number];

export function isAlbumKind(value: unknown): value is AlbumKind {
  return typeof value === "string" && (ALBUM_KINDS as readonly string[]).includes(value);
}

/** Which kinds move, and therefore need a poster frame drawn for them. */
export function moves(kind: AlbumKind): boolean {
  return kind === "clip" || kind === "video" || kind === "recording";
}

/**
 * One memory, as the browser sees it.
 *
 * Instants are ISO 8601 strings rather than Date objects: these cross a JSON
 * boundary, and a Date that has been through JSON.parse is a string wearing the
 * wrong type. Parsing happens once, deliberately, where a date is needed.
 */
export interface AlbumItem {
  id: string;
  kind: AlbumKind;
  contentType: string;
  bytes: number;
  /** When it happened. May be earlier than createdAt, often much earlier. */
  happenedAt: string;
  /** When it arrived. The only order a polling cursor can trust. */
  createdAt: string;
  caption: string | null;
  loved: boolean;
  sourceRoom: string | null;
  /** Signed and short-lived, minted per page load. */
  url: string;
  /** A still, for anything that moves. Null for a photograph. */
  posterUrl: string | null;
}

/**
 * How far out the reel is zoomed. Three gears on one strip of film, not three
 * tabs: a tab re-sorts and loses your place, a gear does not.
 */
export const GEARS = ["frames", "days", "months"] as const;
export type Gear = (typeof GEARS)[number];

export function isGear(value: unknown): value is Gear {
  return typeof value === "string" && (GEARS as readonly string[]).includes(value);
}

/**
 * One frame on the reel.
 *
 * In `frames` gear a frame is one memory. In `days` and `months` it stands for
 * a group, showing `item` as the representative and saying how many it speaks
 * for. The shape is identical in all three so the component drawing a frame
 * never asks which gear it is in.
 */
export interface Frame {
  /**
   * Stable for the same group across renders, so React keys and scroll
   * restoration survive a refetch. Not stable across gears -- the groups are
   * genuinely different things.
   */
  key: string;
  /** The picture this frame shows. */
  item: AlbumItem;
  /** Every memory this frame stands for, newest first. `frames` gear: one. */
  items: AlbumItem[];
  /** `items.length`, hoisted because the badge needs it on every render. */
  count: number;
  /**
   * True when ANY memory in the group is loved. This is what lights the warm
   * bloom on the reel, so a loved photograph inside a busy day must not be
   * hidden by the nine ordinary ones beside it.
   */
  loved: boolean;
  /** The civil day this frame starts on, YYYY-MM-DD in the reel's zone. */
  date: string;
}

/**
 * The marked, labelled film spliced between reels -- what separates one month
 * from the next.
 */
export interface LeaderTape {
  /** Sits immediately before `frames[beforeIndex]`. */
  beforeIndex: number;
  /** "February 2026". Rendered in the display face; a month is identity. */
  label: string;
  /** YYYY-MM. */
  month: string;
}

/** An occasion, as stored: a title pinned to a date. */
export interface Occasion {
  id: string;
  title: string;
  /** YYYY-MM-DD. A civil date, deliberately not an instant. */
  onDate: string;
  /** Recurs every year on the same month and day. */
  yearly: boolean;
  coverItemId: string | null;
}

/**
 * An occasion placed on a drawn reel: one sign, hanging above one frame.
 *
 * A yearly occasion produces one of these per year the reel spans, which is
 * why this is separate from `Occasion` -- "our first date" is one row and many
 * signs.
 */
export interface OccasionMark {
  occasion: Occasion;
  /** The specific date this sign marks, YYYY-MM-DD. */
  date: string;
  /**
   * Where it hangs. -1 when the reel holds no frame for that date -- an
   * anniversary that has not happened yet, or one nobody photographed.
   */
  frameIndex: number;
  /**
   * Whether the sign is lit. False means the date exists but the film does
   * not, and the sign shows unlit: an invitation, not an error.
   */
  lit: boolean;
}

/** Everything needed to draw the reel, derived in one pass. */
export interface ReelView {
  frames: Frame[];
  tapes: LeaderTape[];
  marks: OccasionMark[];
}

/**
 * The timezone a reel is grouped in.
 *
 * This is the one piece of album state that cannot have a sensible default,
 * and the reason is the whole premise of the app: the two of you are not in
 * the same timezone. A call at 23:00 in London is the next morning in Hanoi,
 * so "which day was that?" has two correct answers and no ambient one.
 *
 * The decision: group in the VIEWER's zone, and pass it in explicitly rather
 * than reading the ambient locale inside the grouping code. Each of you sees
 * your own days, which is what "our Saturday" means to the person asking, and
 * the function stays pure and testable at a fixed zone instead of behaving
 * differently on the machine that runs the tests.
 *
 * An IANA name, e.g. "Europe/London". `resolvedOptions().timeZone` in a
 * browser; the tests pin it.
 */
export type TimeZone = string;
