import { describe, expect, it } from "vitest";
import { backdropKey, isLookKeyFor, overlayKey, sourceKey } from "./keys";

const PAIR = "11111111-2222-3333-8444-555555555555";

describe("look keys", () => {
  it("keeps layers and sources beneath their pair folder", () => {
    expect(backdropKey(PAIR, "abcdef")).toBe(`looks/${PAIR}/abcdef-backdrop.png`);
    expect(overlayKey(PAIR, "abcdef")).toBe(`looks/${PAIR}/abcdef-overlay.png`);
    expect(sourceKey(PAIR, "abcdef", "webp")).toBe(`looks/${PAIR}/src/abcdef.webp`);
  });

  it("rejects paths that are malformed, traversing, or owned by another pair", () => {
    expect(isLookKeyFor(PAIR, `looks/${PAIR}/abcdef-backdrop.png`)).toBe(true);
    for (const key of [
      `looks/${PAIR}/../abcdef-backdrop.png`,
      `looks/${PAIR}\\abcdef-backdrop.png`,
      "looks/22222222-2222-4333-8444-555555555555/abcdef-backdrop.png",
      `looks/${PAIR}/src/../abcdef.png`,
      `looks/${PAIR}/abcdef-paper.png`,
    ])
      expect(isLookKeyFor(PAIR, key)).toBe(false);
  });
});
