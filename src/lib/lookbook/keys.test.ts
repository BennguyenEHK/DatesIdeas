import { describe, expect, it } from "vitest";
import { isLookbookKeyFor, pieceKey } from "./keys";

const PAIR = "8e2d4a1b-1c2d-4e3f-8a9b-0c1d2e3f4a5b";
const OTHER = "11111111-2222-4333-8444-555555555555";

describe("lookbook keys", () => {
  it("files a piece in its pair's own folder by id", () => {
    expect(pieceKey(PAIR, "piece_001", "image/jpeg")).toBe(`lookbook/${PAIR}/piece_001.jpg`);
    expect(() => pieceKey("not-a-pair", "piece_001", "image/jpeg")).toThrow();
    expect(() => pieceKey(PAIR, "../etc", "image/png")).toThrow();
  });

  it("recognises only this pair's piece photos", () => {
    const key = pieceKey(PAIR, "piece_001", "image/webp");
    expect(isLookbookKeyFor(PAIR, key)).toBe(true);
    expect(isLookbookKeyFor(OTHER, key)).toBe(false);
    expect(isLookbookKeyFor(PAIR, `lookbook/${PAIR}/../x.jpg`)).toBe(false);
    expect(isLookbookKeyFor(PAIR, `looks/${PAIR}/piece_001.jpg`)).toBe(false);
  });
});
