/**
 * The six looks a photo strip can have.
 *
 * Written as data rather than as CSS or as canvas calls, because two different
 * painters have to produce the same picture: the browser paints the live
 * preview, and a canvas paints the file you keep. Describing each theme twice
 * would guarantee they drift, and the day they drift is the day your saved
 * photograph stops matching the one you were smiling at.
 *
 * So every field here is something BOTH painters can do. Gradients, radial
 * glows, blend modes and greyscale all exist in CSS and on a canvas under the
 * same names. Nothing that only one of them understands gets in.
 *
 * They are six times of night in one city rather than six unrelated colour
 * schemes — which is how the film this app is themed on actually works, each
 * scene lit by a single dominant source rather than decorated.
 */

export const THEME_IDS = [
  "griffith",
  "goldenHour",
  "rose",
  "planetarium",
  "neon",
  "silver",
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

/** A colour stop down the vertical sky gradient. `at` runs 0 (top) to 1. */
export interface Stop {
  at: number;
  color: string;
}

/**
 * A single light source blooming into the frame. Positions are fractions of
 * the strip, so a theme looks the same at any size.
 */
export interface Glow {
  x: number;
  y: number;
  /** Fraction of the strip's width. */
  radius: number;
  color: string;
}

/**
 * The wash laid over the photographs themselves.
 *
 * This is what makes two people in two different rooms look like they are in
 * one photograph: the same light falls on both faces. Without it a strip is
 * two webcam grabs pasted onto a nice background, and it reads as exactly that.
 */
export interface Grade {
  color: string;
  alpha: number;
  /** Named identically in CSS mix-blend-mode and canvas globalCompositeOperation. */
  mode: "overlay" | "multiply" | "soft-light";
}

export interface Theme {
  id: ThemeId;
  label: string;
  /** One line, shown under the name while picking. */
  note: string;
  sky: Stop[];
  glows: Glow[];
  grade: Grade | null;
  /** How many stars. Positions are derived from the id, so they never move. */
  stars: number;
  /** How dark the corners go. What makes a picture read as a photograph. */
  vignette: number;
  /** 0 to 1. Only the black-and-white theme uses it. */
  desaturate: number;
  /** The caption band's lettering. */
  ink: string;
  /** The strip's border. */
  frame: string;
}

export const THEMES: readonly Theme[] = [
  {
    id: "griffith",
    label: "Griffith",
    note: "Twilight over the observatory, one streetlamp.",
    // The app's own ground colours. This theme is the booth sitting inside
    // FestiBooth rather than visiting from somewhere else.
    sky: [
      { at: 0, color: "#0e1430" },
      { at: 0.55, color: "#1e2148" },
      { at: 1, color: "#2c2657" },
    ],
    glows: [{ x: 0.78, y: 0.86, radius: 0.62, color: "rgba(232,185,74,0.30)" }],
    grade: { color: "#e8b94a", alpha: 0.16, mode: "soft-light" },
    stars: 46,
    vignette: 0.42,
    desaturate: 0,
    ink: "#f5efe0",
    frame: "#e8b94a",
  },
  {
    id: "goldenHour",
    label: "Golden hour",
    note: "The last warm light, low and long.",
    sky: [
      { at: 0, color: "#f6b26a" },
      { at: 0.42, color: "#e0715f" },
      { at: 1, color: "#5f2f5c" },
    ],
    // Low and to the left, where a setting sun would be. The most flattering
    // of the six on camera: warm light suits skin and forgives a dim room.
    glows: [{ x: 0.16, y: 0.9, radius: 0.75, color: "rgba(255,215,154,0.45)" }],
    grade: { color: "#f6b86a", alpha: 0.2, mode: "overlay" },
    stars: 0,
    vignette: 0.34,
    desaturate: 0,
    ink: "#42203f",
    frame: "#f5efe0",
  },
  {
    id: "rose",
    label: "Rose",
    note: "Soft light, the one you would print.",
    sky: [
      { at: 0, color: "#f7ccd2" },
      { at: 0.48, color: "#d4737f" },
      { at: 1, color: "#6f2b46" },
    ],
    glows: [{ x: 0.5, y: 0.08, radius: 0.7, color: "rgba(255,224,230,0.5)" }],
    grade: { color: "#e2879a", alpha: 0.2, mode: "soft-light" },
    stars: 0,
    vignette: 0.3,
    desaturate: 0,
    ink: "#5c2038",
    frame: "#f7ccd2",
  },
  {
    id: "planetarium",
    label: "Planetarium",
    note: "Off the floor entirely, among the stars.",
    sky: [
      { at: 0, color: "#1b1147" },
      { at: 0.5, color: "#0a0620" },
      { at: 1, color: "#04030f" },
    ],
    glows: [{ x: 0.5, y: 0.42, radius: 0.55, color: "rgba(120,96,220,0.22)" }],
    grade: { color: "#6a5acd", alpha: 0.14, mode: "multiply" },
    // The most stars of the six, and the theme where a cut-out reads best:
    // the background is genuinely dark and simple, so an imperfect edge on
    // someone's hair has nothing to give itself away against.
    stars: 150,
    vignette: 0.55,
    desaturate: 0,
    ink: "#e9e4ff",
    frame: "#8f86d6",
  },
  {
    id: "neon",
    label: "Neon",
    note: "A club sign, magenta one side, cyan the other.",
    sky: [
      { at: 0, color: "#0b0a14" },
      { at: 1, color: "#160c1e" },
    ],
    // Two sources, deliberately opposed. A single neon glow reads as a
    // coloured wash; two colours pulling against each other read as signage.
    glows: [
      { x: 0.04, y: 0.3, radius: 0.6, color: "rgba(255,61,129,0.42)" },
      { x: 0.98, y: 0.74, radius: 0.6, color: "rgba(53,214,232,0.34)" },
    ],
    grade: { color: "#c74b6d", alpha: 0.14, mode: "overlay" },
    stars: 0,
    vignette: 0.5,
    desaturate: 0,
    ink: "#35d6e8",
    frame: "#ff3d81",
  },
  {
    id: "silver",
    label: "Silver screen",
    note: "Black and white, like the pictures they went to see.",
    sky: [
      { at: 0, color: "#dbd7cf" },
      { at: 0.55, color: "#918d87" },
      { at: 1, color: "#35332f" },
    ],
    glows: [{ x: 0.5, y: 0.18, radius: 0.8, color: "rgba(255,255,255,0.28)" }],
    grade: null,
    stars: 0,
    // Heavier than the rest, because with the colour gone the vignette is the
    // only thing left saying "photograph" rather than "grey rectangle".
    vignette: 0.6,
    desaturate: 1,
    ink: "#1a1a18",
    frame: "#1a1a18",
  },
];

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === "string" && (THEME_IDS as readonly string[]).includes(v);
}

export function theme(id: ThemeId): Theme {
  const found = THEMES.find((t) => t.id === id);
  if (!found) throw new Error(`unknown theme: ${id}`);
  return found;
}

export const DEFAULT_THEME_ID: ThemeId = "griffith";

/**
 * A small deterministic generator, so a star field is identical everywhere.
 *
 * Math.random would put the stars in one place in the preview and somewhere
 * else in the saved file, and somewhere else again on the other person's
 * screen — three different skies for one photograph. Seeding from the theme's
 * own name means every painter, on every machine, draws the same sky.
 *
 * This is mulberry32: short, fast, and good enough for scattering dots.
 */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Turns a theme id into a stable seed. */
export function seedFor(id: ThemeId): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface Star {
  /** Fractions of the strip, so they scale with it. */
  x: number;
  y: number;
  radius: number;
  alpha: number;
}

/**
 * Where this theme's stars go.
 *
 * Derived rather than stored: a hundred and fifty hand-written coordinates
 * would be unreadable, unmaintainable, and no more stable than this.
 */
export function starsFor(t: Theme): Star[] {
  const rand = seeded(seedFor(t.id));
  return Array.from({ length: t.stars }, () => ({
    x: rand(),
    y: rand(),
    // Squared so most stars are small and a few are bright, which is what a
    // real sky looks like. A uniform scatter reads as a texture, not a sky.
    radius: 0.0007 + rand() ** 2 * 0.0022,
    alpha: 0.25 + rand() * 0.65,
  }));
}
