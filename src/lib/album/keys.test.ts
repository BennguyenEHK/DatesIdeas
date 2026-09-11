import { describe, it, expect } from "vitest";
import {
  MAX_ALBUM_MB,
  albumExtension,
  albumKey,
  allowsContentType,
  isAlbumKey,
  needsPoster,
  posterKeyFor,
  withinCap,
} from "./keys";

const PAIR = "11111111-2222-3333-4444-555555555555";

describe("albumKey", () => {
  it("puts an item under its own pair", () => {
    expect(albumKey(PAIR, "photo", "jpg", "abc123")).toBe(
      `album/${PAIR}/photo-abc123.jpg`,
    );
  });

  it("refuses a pair id that is not a uuid", () => {
    // The pair id comes from an authenticated lookup, so this should be
    // impossible -- which is why it is asserted rather than assumed.
    expect(() => albumKey("../../other", "photo", "jpg", "abc")).toThrow(TypeError);
  });

  it("refuses a token that could escape the namespace", () => {
    for (const token of ["../evil", "a/b", "a\\b", ""]) {
      expect(() => albumKey(PAIR, "photo", "jpg", token)).toThrow(TypeError);
    }
  });

  it("refuses an extension that is not one", () => {
    for (const extension of ["", "../", "j/pg", "TOOLONG", "p.g"]) {
      expect(() => albumKey(PAIR, "photo", extension, "abc")).toThrow(TypeError);
    }
  });

  it("produces a key the signer will accept", () => {
    for (const kind of ["strip", "clip", "photo", "video", "recording"] as const) {
      expect(isAlbumKey(albumKey(PAIR, kind, "mp4", "tok_en-1"))).toBe(true);
    }
  });
});

describe("isAlbumKey", () => {
  it("rejects keys outside the album namespace", () => {
    // The signer's whole job. A key it accepts is a key it will grant write
    // access to, so anything reaching past album/<pair>/ must be refused.
    for (const key of [
      "keepsakes/ABCDEF/strip-x.png",
      "album/../secret.png",
      `album/${PAIR}/../../secret.png`,
      `album/${PAIR}\\photo-x.jpg`,
      `album/${PAIR}/photo-x.jpg/../../y`,
      "album//photo-x.jpg",
      `album/${PAIR}/unknownkind-x.jpg`,
      `album/${PAIR}/photo-x`,
      "",
    ]) {
      expect(isAlbumKey(key)).toBe(false);
    }
  });

  it("accepts a poster beside its item", () => {
    expect(isAlbumKey(`album/${PAIR}/video-abc-poster.jpg`)).toBe(true);
  });
});

describe("posterKeyFor", () => {
  it("sits beside the item it stands for, as a jpeg", () => {
    const key = albumKey(PAIR, "video", "mp4", "abc");
    expect(posterKeyFor(key)).toBe(`album/${PAIR}/video-abc-poster.jpg`);
    expect(isAlbumKey(posterKeyFor(key))).toBe(true);
  });

  it("refuses to derive one from a key the signer would not accept", () => {
    expect(() => posterKeyFor("keepsakes/ABCDEF/strip-x.png")).toThrow(TypeError);
  });
});

describe("needsPoster", () => {
  it("is true for everything that moves and false for a photograph", () => {
    expect(needsPoster("video")).toBe(true);
    expect(needsPoster("clip")).toBe(true);
    expect(needsPoster("recording")).toBe(true);
    expect(needsPoster("photo")).toBe(false);
    expect(needsPoster("strip")).toBe(false);
  });
});

describe("content types and caps", () => {
  it("allows only what each kind is meant to hold", () => {
    expect(allowsContentType("photo", "image/jpeg")).toBe(true);
    expect(allowsContentType("photo", "IMAGE/JPEG")).toBe(true);
    // A signed URL serves whatever type it was signed for. An unchecked value
    // would let a caller have this app host arbitrary content from our bucket.
    expect(allowsContentType("photo", "text/html")).toBe(false);
    expect(allowsContentType("photo", "video/mp4")).toBe(false);
    expect(allowsContentType("strip", "image/jpeg")).toBe(false);
  });

  it("maps a content type to the extension actually stored", () => {
    expect(albumExtension("image/jpeg")).toBe("jpg");
    expect(albumExtension("video/quicktime")).toBe("mov");
    expect(albumExtension("application/x-msdownload")).toBeNull();
  });

  it("holds the line at the cap", () => {
    const mb = 1024 * 1024;
    expect(withinCap("photo", MAX_ALBUM_MB.photo * mb)).toBe(true);
    expect(withinCap("photo", MAX_ALBUM_MB.photo * mb + 1)).toBe(false);
    expect(withinCap("video", MAX_ALBUM_MB.video * mb)).toBe(true);
    for (const bytes of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(withinCap("photo", bytes)).toBe(false);
    }
  });
});
