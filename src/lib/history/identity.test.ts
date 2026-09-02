import { describe, it, expect, beforeEach } from "vitest";
import {
  getIdentity,
  getDisplayName,
  setDisplayName,
  getSavedRoom,
  saveRoom,
  getRoomHistory,
} from "./identity";

beforeEach(() => localStorage.clear());

describe("identity", () => {
  it("returns a stable id across calls", () => {
    const a = getIdentity();
    const b = getIdentity();
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(10);
  });

  it("persists the id in localStorage", () => {
    const id = getIdentity();
    expect(localStorage.getItem("datesidea.identity")).toBe(id);
  });

  it("round-trips a display name", () => {
    expect(getDisplayName()).toBeNull();
    setDisplayName("Ben");
    expect(getDisplayName()).toBe("Ben");
  });

  it("survives storage being unavailable", () => {
    // Reads and writes are wrapped because localStorage throws outright in a
    // private window rather than returning null, and none of what is kept
    // here is worth a blank page.
    const real = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    expect(() => getDisplayName()).not.toThrow();
    expect(() => setDisplayName("Ben")).not.toThrow();
    expect(() => getSavedRoom()).not.toThrow();
    expect(() => saveRoom("ABCDEF")).not.toThrow();
    expect(() => getRoomHistory()).not.toThrow();
    if (real) Object.defineProperty(window, "localStorage", real);
  });
});

describe("the room this device is in", () => {
  it("has no room before one is entered", () => {
    expect(getSavedRoom()).toBeNull();
  });

  it("remembers the last room entered", () => {
    saveRoom("ABCDEF");
    expect(getSavedRoom()).toBe("ABCDEF");
  });

  it("stores it uppercase, so a hand-typed link matches", () => {
    saveRoom("abcdef");
    expect(getSavedRoom()).toBe("ABCDEF");
  });
});

describe("the rooms this device has been in", () => {
  it("starts empty", () => {
    expect(getRoomHistory()).toEqual([]);
  });

  it("accumulates a room each evening, newest first", () => {
    saveRoom("AAAAAA");
    saveRoom("BBBBBB");
    saveRoom("CCCCCC");
    expect(getRoomHistory()).toEqual(["CCCCCC", "BBBBBB", "AAAAAA"]);
  });

  it("keeps yesterday's rooms when today's is entered", () => {
    // This is the whole reason the list exists: a nightly code would
    // otherwise leave "Past evenings" empty every morning.
    saveRoom("AAAAAA");
    saveRoom("BBBBBB");
    expect(getRoomHistory()).toContain("AAAAAA");
  });

  it("does not list a room twice when you rejoin it", () => {
    saveRoom("AAAAAA");
    saveRoom("BBBBBB");
    saveRoom("AAAAAA");
    expect(getRoomHistory()).toEqual(["AAAAAA", "BBBBBB"]);
  });

  it("ignores something that is not a room code", () => {
    saveRoom("AAAAAA");
    saveRoom("nope");
    expect(getRoomHistory()).toEqual(["AAAAAA"]);
  });

  it("recovers from storage that has been corrupted", () => {
    localStorage.setItem("datesidea.rooms", "{not json");
    expect(getRoomHistory()).toEqual([]);
    saveRoom("AAAAAA");
    expect(getRoomHistory()).toEqual(["AAAAAA"]);
  });

  it("picks up a device that only ever knew a single room", () => {
    // Upgrading from the previous version: one saved room, no list yet. That
    // evening's history should not vanish because the format changed.
    localStorage.setItem("datesidea.room", "ZZZZZZ");
    expect(getRoomHistory()).toEqual(["ZZZZZZ"]);
  });
});
