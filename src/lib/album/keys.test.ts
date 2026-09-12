import { describe, it, expect } from "vitest";
import {
  MAX_ALBUM_MB,
  albumExtension,
  albumKey,
  allowsContentType,
  isAlbumKey,
  isLegacyAlbumKey,
  needsPoster,
  posterKeyFor,
  withinCap,
} from "./keys";

const PAIR = "11111111-2222-3333-4444-555555555555";
const AT = "2026-09-13T04:30:00.000Z";
const CHICAGO = -300;

describe("albumKey", () => {
  it("files an item by year and month, named by day, time and kind", () => {
    expect(albumKey(AT, CHICAGO, "photo", "jpg", "3f9a0c1e")).toBe(
      "album/2026/09/12_23-30-00_photo_3f9a0c1e.jpg",
    );
  });

  it("files an old memory under the year it happened", () => {
    expect(albumKey("2024-05-14T19:32:05.000Z", 0, "photo", "jpg", "3f9a0c1e")).toBe(
      "album/2024/05/14_19-32-05_photo_3f9a0c1e.jpg",
    );
  });

  it("refuses a token that is not lowercase hex of a safe length", () => {
    for (const token of ["../evil", "a/b", "a\\b", "", "abc", "ABCDEF12", "abcd_ef12", "abcd-ef12"]) {
      expect(() => albumKey(AT, 0, "photo", "jpg", token)).toThrow(TypeError);
    }
  });

  it("refuses an extension that is not one", () => {
    for (const extension of ["", "../", "j/pg", "TOOLONG", "p.g"]) {
      expect(() => albumKey(AT, 0, "photo", extension, "3f9a0c1e")).toThrow(TypeError);
    }
  });

  it("produces a key the signer will accept", () => {
    for (const kind of ["strip", "clip", "photo", "video", "recording"] as const) {
      expect(isAlbumKey(albumKey(AT, CHICAGO, kind, "mp4", "3f9a0c1e"))).toBe(true);
    }
  });
});

describe("isAlbumKey", () => {
  it("rejects keys outside the album namespace", () => {
    // The signer's whole job. A key it accepts is a key it will grant write
    // access to, so anything reaching outside album/<year>/<month>/ is refused.
    for (const key of [
      "keepsakes/2026/09/12_23-30-00_strip_KW3KDD_3f9a0c1e.png",
      "album/../secret.png",
      "album/2026/09/../../secret.png",
      "album/2026/09\\12_23-30-00_photo_3f9a0c1e.jpg",
      "album/2026/09/12_23-30-00_photo_3f9a0c1e.jpg/../../y",
      "album/2026/13/12_23-30-00_photo_3f9a0c1e.jpg",
      "album/2026/09/12_23-30-00_unknownkind_3f9a0c1e.jpg",
      "album/2026/09/12_23-30-00_photo_3f9a0c1e",
      "album/2026/09/extra/12_23-30-00_photo_3f9a0c1e.jpg",
      `album/${PAIR}/photo-abc.jpg`,
      "",
    ]) {
      expect(isAlbumKey(key)).toBe(false);
    }
  });

  it("accepts a poster beside its item", () => {
    expect(isAlbumKey("album/2026/09/12_23-30-00_video_3f9a0c1e-poster.jpg")).toBe(true);
  });
});

describe("isLegacyAlbumKey", () => {
  it("still recognises an entry saved before files were filed by date", () => {
    expect(isLegacyAlbumKey(`album/${PAIR}/photo-917b7f35374c8770.jpg`)).toBe(true);
    expect(isLegacyAlbumKey(`album/${PAIR}/video-abc-poster.jpg`)).toBe(true);
    expect(isLegacyAlbumKey(`album/${PAIR}/../../secret.png`)).toBe(false);
    expect(isLegacyAlbumKey("album/2026/09/12_23-30-00_photo_3f9a0c1e.jpg")).toBe(false);
  });
});

describe("posterKeyFor", () => {
  it("sits beside the item it stands for, as a jpeg", () => {
    const key = albumKey(AT, CHICAGO, "video", "mp4", "3f9a0c1e");
    expect(posterKeyFor(key)).toBe("album/2026/09/12_23-30-00_video_3f9a0c1e-poster.jpg");
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
