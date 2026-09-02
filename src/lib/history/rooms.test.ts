import { describe, it, expect } from "vitest";
import { MAX_REMEMBERED_ROOMS, rememberRoom, readRoomList } from "./rooms";
import { ROOM_CODE_ALPHABET, isValidRoomCode } from "@/lib/room/code";

describe("rememberRoom", () => {
  it("puts the newest room first", () => {
    expect(rememberRoom(["AAAAAA"], "BBBBBB")).toEqual(["BBBBBB", "AAAAAA"]);
  });

  it("starts a list from nothing", () => {
    expect(rememberRoom([], "AAAAAA")).toEqual(["AAAAAA"]);
  });

  it("moves a room you return to back to the front", () => {
    // Not a second entry: the list is a set with an order.
    expect(rememberRoom(["AAAAAA", "BBBBBB"], "BBBBBB")).toEqual([
      "BBBBBB",
      "AAAAAA",
    ]);
  });

  it("stores codes uppercase, however they were typed", () => {
    expect(rememberRoom([], "abcdef")).toEqual(["ABCDEF"]);
    expect(rememberRoom(["ABCDEF"], "abcdef")).toEqual(["ABCDEF"]);
  });

  it("keeps a code that is not a real room code out of the list", () => {
    // The list is fed straight into a database query; nothing shapeless
    // should be able to reach it.
    expect(rememberRoom(["AAAAAA"], "nope")).toEqual(["AAAAAA"]);
  });

  it("forgets the oldest rooms once it is full", () => {
    // Real codes, from the real alphabet — a fixture of strings the app would
    // reject is a fixture that can stop exercising the rule.
    const A = ROOM_CODE_ALPHABET;
    const full = Array.from(
      { length: MAX_REMEMBERED_ROOMS },
      (_, i) => `AAAA${A[Math.floor(i / A.length)]}${A[i % A.length]}`,
    );
    expect(full.every(isValidRoomCode)).toBe(true);
    expect(new Set(full).size).toBe(full.length);
    const next = rememberRoom(full, "ZZZZZZ");
    expect(next).toHaveLength(MAX_REMEMBERED_ROOMS);
    expect(next[0]).toBe("ZZZZZZ");
    expect(next).not.toContain(full[full.length - 1]);
  });

  it("remembers a month of nightly rooms", () => {
    // A new code every evening: the cap has to outlast a habit, or the log
    // starts losing evenings that are still recent.
    expect(MAX_REMEMBERED_ROOMS).toBeGreaterThanOrEqual(30);
  });
});

describe("readRoomList", () => {
  it("reads a stored list", () => {
    expect(readRoomList('["AAAAAA","BBBBBB"]')).toEqual(["AAAAAA", "BBBBBB"]);
  });

  it("returns nothing when there is nothing stored", () => {
    expect(readRoomList(null)).toEqual([]);
  });

  it("survives storage that has been corrupted or hand-edited", () => {
    // localStorage is user-writable. Throwing here would break the home page.
    expect(readRoomList("{not json")).toEqual([]);
    expect(readRoomList('"a string"')).toEqual([]);
    expect(readRoomList("[1,2,3]")).toEqual([]);
  });

  it("drops entries that are not room codes", () => {
    expect(readRoomList('["AAAAAA","../etc",""]')).toEqual(["AAAAAA"]);
  });

  it("caps what it reads back, not just what it writes", () => {
    const many = JSON.stringify(
      Array.from({ length: 500 }, () => "AAAAAA"),
    );
    expect(readRoomList(many).length).toBeLessThanOrEqual(MAX_REMEMBERED_ROOMS);
  });
});
