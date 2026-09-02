import { describe, it, expect } from "vitest";
import {
  ROOM_TTL_HOURS,
  ROOM_TTL_MS,
  isOpen,
  remainingMs,
  formatRemaining,
} from "./lifetime";

const NOW = Date.parse("2026-09-02T20:00:00Z");
const inHours = (h: number) => new Date(NOW + h * 3600_000).toISOString();

describe("the room's day", () => {
  it("lasts twenty-four hours", () => {
    expect(ROOM_TTL_HOURS).toBe(24);
    expect(ROOM_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe("isOpen", () => {
  it("is open while the expiry is ahead", () => {
    expect(isOpen(inHours(1), NOW)).toBe(true);
  });

  it("is closed once the expiry has passed", () => {
    expect(isOpen(inHours(-1), NOW)).toBe(false);
  });

  it("is closed exactly at the boundary", () => {
    // The database gate is `expires_at > now()`. This has to agree with it,
    // or the page says open while signalling returns 410.
    expect(isOpen(inHours(0), NOW)).toBe(false);
  });

  it("treats a room it knows nothing about as closed", () => {
    // A code that was never created must not be presented as a live room.
    expect(isOpen(null, NOW)).toBe(false);
    expect(isOpen(undefined, NOW)).toBe(false);
  });

  it("treats an unreadable timestamp as closed", () => {
    expect(isOpen("not a date", NOW)).toBe(false);
  });

  it("accepts a Date as readily as a string", () => {
    expect(isOpen(new Date(NOW + 3600_000), NOW)).toBe(true);
  });
});

describe("remainingMs", () => {
  it("counts down to the expiry", () => {
    expect(remainingMs(inHours(2), NOW)).toBe(2 * 3600_000);
  });

  it("never goes negative", () => {
    // A negative would format as "closes in -3h" somewhere downstream.
    expect(remainingMs(inHours(-3), NOW)).toBe(0);
    expect(remainingMs(null, NOW)).toBe(0);
  });
});

describe("formatRemaining", () => {
  it("speaks in whole hours while there are hours left", () => {
    expect(formatRemaining(23.9 * 3600_000)).toBe("23h");
    expect(formatRemaining(1 * 3600_000)).toBe("1h");
  });

  it("switches to minutes inside the last hour", () => {
    expect(formatRemaining(59 * 60_000)).toBe("59m");
    expect(formatRemaining(1 * 60_000)).toBe("1m");
  });

  it("says something human in the last minute", () => {
    // "0m" reads like it is already over when it is not.
    expect(formatRemaining(30_000)).toBe("under a minute");
  });

  it("says closed at zero", () => {
    expect(formatRemaining(0)).toBe("closed");
  });
});
