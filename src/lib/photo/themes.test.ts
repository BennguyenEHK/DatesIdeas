import { describe, it, expect } from "vitest";
import {
  THEMES,
  THEME_IDS,
  DEFAULT_THEME_ID,
  isThemeId,
  theme,
  seeded,
  seedFor,
  starsFor,
} from "./themes";

describe("the set of themes", () => {
  it("offers the six that were asked for", () => {
    expect(THEME_IDS).toHaveLength(6);
    expect(THEMES).toHaveLength(6);
  });

  it("has no duplicate ids", () => {
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
  });

  it("lists every id in the registry", () => {
    // A theme reachable through THEMES but not THEME_IDS would be pickable
    // and unvalidatable, which is how a bad id reaches the painter.
    expect(THEMES.map((t) => t.id).sort()).toEqual([...THEME_IDS].sort());
  });

  it("defaults to one that exists", () => {
    expect(isThemeId(DEFAULT_THEME_ID)).toBe(true);
    expect(() => theme(DEFAULT_THEME_ID)).not.toThrow();
  });

  it("refuses an id it does not know", () => {
    expect(isThemeId("sepia")).toBe(false);
    expect(() => theme("sepia" as never)).toThrow();
  });
});

describe("what every theme must provide", () => {
  it.each(THEMES.map((t) => [t.id, t] as const))(
    "%s is fully described",
    (_id, t) => {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.note.length).toBeGreaterThan(0);
      expect(t.ink).toMatch(/^#/);
      expect(t.frame).toMatch(/^#/);
    },
  );

  it.each(THEMES.map((t) => [t.id, t] as const))(
    "%s has a sky that spans top to bottom",
    (_id, t) => {
      // A gradient that starts at 0.3 leaves the top of the strip unpainted.
      expect(t.sky.length).toBeGreaterThanOrEqual(2);
      expect(t.sky[0].at).toBe(0);
      expect(t.sky.at(-1)!.at).toBe(1);
    },
  );

  it.each(THEMES.map((t) => [t.id, t] as const))(
    "%s has sky stops in ascending order",
    (_id, t) => {
      const ats = t.sky.map((s) => s.at);
      expect([...ats].sort((a, b) => a - b)).toEqual(ats);
    },
  );

  it.each(THEMES.map((t) => [t.id, t] as const))(
    "%s keeps its light sources on the strip",
    (_id, t) => {
      for (const g of t.glows) {
        expect(g.x).toBeGreaterThanOrEqual(0);
        expect(g.x).toBeLessThanOrEqual(1);
        expect(g.y).toBeGreaterThanOrEqual(0);
        expect(g.y).toBeLessThanOrEqual(1);
        expect(g.radius).toBeGreaterThan(0);
      }
    },
  );

  it.each(THEMES.map((t) => [t.id, t] as const))(
    "%s stays within the ranges both painters accept",
    (_id, t) => {
      // Every one of these maps onto a CSS value and a canvas value. Out of
      // range, the two painters clamp differently and diverge.
      expect(t.vignette).toBeGreaterThanOrEqual(0);
      expect(t.vignette).toBeLessThanOrEqual(1);
      expect(t.desaturate).toBeGreaterThanOrEqual(0);
      expect(t.desaturate).toBeLessThanOrEqual(1);
      expect(t.stars).toBeGreaterThanOrEqual(0);
      if (t.grade) {
        expect(t.grade.alpha).toBeGreaterThan(0);
        expect(t.grade.alpha).toBeLessThanOrEqual(1);
        expect(["overlay", "multiply", "soft-light"]).toContain(t.grade.mode);
      }
    },
  );
});

describe("the star field", () => {
  it("puts the stars in the same place every time", () => {
    // The whole reason it is seeded. Math.random would give the preview one
    // sky, the saved file another, and the other person's screen a third.
    const a = starsFor(theme("planetarium"));
    const b = starsFor(theme("planetarium"));
    expect(a).toEqual(b);
  });

  it("gives different themes different skies", () => {
    expect(seedFor("planetarium")).not.toBe(seedFor("griffith"));
  });

  it("makes as many stars as the theme asked for", () => {
    expect(starsFor(theme("planetarium"))).toHaveLength(150);
    expect(starsFor(theme("rose"))).toHaveLength(0);
  });

  it("keeps every star inside the strip", () => {
    for (const s of starsFor(theme("planetarium"))) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThan(1);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThan(1);
      expect(s.radius).toBeGreaterThan(0);
      expect(s.alpha).toBeGreaterThan(0);
      expect(s.alpha).toBeLessThanOrEqual(1);
    }
  });

  it("makes most stars small and a few bright", () => {
    // A uniform scatter reads as a texture rather than a sky.
    const radii = starsFor(theme("planetarium")).map((s) => s.radius);
    const mid = (Math.min(...radii) + Math.max(...radii)) / 2;
    const small = radii.filter((r) => r < mid).length;
    expect(small).toBeGreaterThan(radii.length * 0.6);
  });
});

describe("the generator behind it", () => {
  it("repeats exactly for a repeated seed", () => {
    const a = seeded(42);
    const b = seeded(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("stays between zero and one", () => {
    const rand = seeded(7);
    for (let i = 0; i < 500; i++) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("does not get stuck on one value", () => {
    const rand = seeded(1);
    const seen = new Set(Array.from({ length: 50 }, () => rand()));
    expect(seen.size).toBeGreaterThan(40);
  });
});
