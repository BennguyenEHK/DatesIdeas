import { describe, expect, it } from "vitest";
import { isKaraokeKey, karaokeKey, karaokeRoom } from "./keys";

describe("karaokeKey", () => {
  it("names the song under its room with 32 lowercase hex characters", () => {
    expect(karaokeKey("KW3KDD")).toMatch(/^karaoke\/KW3KDD\/[0-9a-f]{32}\.mp4$/);
  });

  it("writes the room in capitals however it was typed", () => {
    expect(karaokeKey("kw3kdd")).toMatch(/^karaoke\/KW3KDD\//);
  });

  it("never gives the same key twice", () => {
    expect(karaokeKey("KW3KDD")).not.toBe(karaokeKey("KW3KDD"));
  });

  it("throws a TypeError for something that is not a room code", () => {
    for (const room of ["", "KW3KD", "KW3KDDD", "KW0KDD", "../../x", "KW3K/D"]) {
      expect(() => karaokeKey(room)).toThrow(TypeError);
    }
  });

  it("makes a key that isKaraokeKey accepts", () => {
    expect(isKaraokeKey(karaokeKey("KW3KDD"))).toBe(true);
  });
});

describe("isKaraokeKey", () => {
  const token = "0123456789abcdef0123456789abcdef";

  it("accepts exactly the shape karaokeKey makes", () => {
    expect(isKaraokeKey(`karaoke/KW3KDD/${token}.mp4`)).toBe(true);
  });

  it("rejects anything that is not a string", () => {
    for (const value of [undefined, null, 5, {}, ["karaoke"]]) {
      expect(isKaraokeKey(value)).toBe(false);
    }
  });

  it("rejects path traversal and backslashes", () => {
    expect(isKaraokeKey(`karaoke/../album/${token}.mp4`)).toBe(false);
    expect(isKaraokeKey(`karaoke/KW3KDD/..${token}.mp4`)).toBe(false);
    expect(isKaraokeKey(`karaoke\KW3KDD\${token}.mp4`)).toBe(false);
  });

  it("rejects a token that is the wrong length or not lowercase hex", () => {
    expect(isKaraokeKey(`karaoke/KW3KDD/${token.slice(1)}.mp4`)).toBe(false);
    expect(isKaraokeKey(`karaoke/KW3KDD/${token}0.mp4`)).toBe(false);
    expect(isKaraokeKey(`karaoke/KW3KDD/${token.toUpperCase()}.mp4`)).toBe(false);
    expect(isKaraokeKey(`karaoke/KW3KDD/${"g".repeat(32)}.mp4`)).toBe(false);
  });

  it("rejects the wrong extension, folder depth or room shape", () => {
    expect(isKaraokeKey(`karaoke/KW3KDD/${token}.webm`)).toBe(false);
    expect(isKaraokeKey(`karaoke/KW3KDD/${token}.mp4/x`)).toBe(false);
    expect(isKaraokeKey(`karaoke/KW3KDD/sub/${token}.mp4`)).toBe(false);
    expect(isKaraokeKey(`karaoke/kw3kdd/${token}.mp4`)).toBe(false);
    expect(isKaraokeKey(`karaoke/KW3KD/${token}.mp4`)).toBe(false);
    expect(isKaraokeKey(`album/KW3KDD/${token}.mp4`)).toBe(false);
    expect(isKaraokeKey(`xkaraoke/KW3KDD/${token}.mp4`)).toBe(false);
  });
});

describe("karaokeRoom", () => {
  it("reads the room out of a karaoke key", () => {
    expect(karaokeRoom(karaokeKey("KW3KDD"))).toBe("KW3KDD");
  });

  it("places nothing it does not recognise", () => {
    expect(karaokeRoom("karaoke/KW3KDD/notes.txt")).toBeNull();
    expect(karaokeRoom("keepsakes/KW3KDD/strip-a.png")).toBeNull();
    expect(karaokeRoom("")).toBeNull();
  });
});
