import { describe, expect, it } from "vitest";
import { decode, encode } from "./protocol";

describe("album and calendar messages", () => {
  it("decodes which photograph and view the album is showing", () => {
    expect(decode(encode({ t: "album-view", itemId: "item-1", gear: "days" }))).toEqual({
      t: "album-view",
      itemId: "item-1",
      gear: "days",
    });
    expect(decode(encode({ t: "album-view", itemId: null, gear: "frames" }))).toEqual({
      t: "album-view",
      itemId: null,
      gear: "frames",
    });
  });

  it("refuses an album view with an unknown gear or an oversized id", () => {
    expect(decode(JSON.stringify({ t: "album-view", itemId: "a", gear: "years" }))).toBeNull();
    expect(decode(JSON.stringify({ t: "album-view", itemId: "x".repeat(41), gear: "frames" }))).toBeNull();
    expect(decode(JSON.stringify({ t: "album-view", itemId: "", gear: "frames" }))).toBeNull();
    expect(decode(JSON.stringify({ t: "album-view", gear: "frames" }))).toBeNull();
  });

  it("decodes the week the calendar is showing, and refuses a non-date", () => {
    const start = "2026-09-07T05:00:00.000Z";
    expect(decode(encode({ t: "calendar-week", start }))).toEqual({ t: "calendar-week", start });
    expect(decode(JSON.stringify({ t: "calendar-week", start: "next week" }))).toBeNull();
    expect(decode(JSON.stringify({ t: "calendar-week", start: 5 }))).toBeNull();
  });

  it("decodes the two change notices", () => {
    expect(decode(encode({ t: "album-changed" }))).toEqual({ t: "album-changed" });
    expect(decode(encode({ t: "calendar-changed" }))).toEqual({ t: "calendar-changed" });
  });
});
