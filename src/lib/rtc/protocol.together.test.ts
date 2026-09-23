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

  it("no longer accepts the retired film message", () => {
    const film = { day: "2026-09-12", anchorMs: 1000, pausedAtMs: null };
    expect(decode(JSON.stringify({ t: "film", film, sentAt: 5 }))).toBeNull();
  });

  it("decodes the album join handshake and refuses a malformed invitation", () => {
    const code = "A".repeat(22);
    expect(decode(encode({ t: "album-join-request" }))).toEqual({ t: "album-join-request" });
    expect(decode(encode({ t: "album-join", code, expiresAt: 5 }))).toEqual({ t: "album-join", code, expiresAt: 5 });
    expect(decode(encode({ t: "album-joined", keyId: "key-1" }))).toEqual({ t: "album-joined", keyId: "key-1" });
    expect(decode(JSON.stringify({ t: "album-join", code: "short", expiresAt: 5 }))).toBeNull();
    expect(decode(JSON.stringify({ t: "album-join", code, expiresAt: "soon" }))).toBeNull();
    expect(decode(JSON.stringify({ t: "album-joined", keyId: "" }))).toBeNull();
  });

  it("decodes tonight's music queue and refuses an index off the end of it", () => {
    const queue = [
      { videoId: "dQw4w9WgXcQ", title: "Never Gonna Give You Up", addedBy: "ben" },
      { videoId: "kJQP7kiw5Fk", title: null, addedBy: "k" },
    ];
    const message = { t: "music" as const, queue, index: 1, revision: 3, sentAt: 10 };
    expect(decode(encode(message))).toEqual(message);
    expect(decode(encode({ ...message, index: null }))).toEqual({ ...message, index: null });
    expect(decode(JSON.stringify({ ...message, index: 2 }))).toBeNull();
    expect(decode(JSON.stringify({ ...message, queue: [{ videoId: "not an id", title: null, addedBy: "k" }] }))).toBeNull();
    // Unknown fields on a track are dropped rather than carried into state.
    expect(decode(JSON.stringify({ ...message, index: 0, queue: [{ ...queue[0], extra: "dropped" }] }))).toEqual({
      ...message,
      index: 0,
      queue: [queue[0]],
    });
  });

  it("decodes the two change notices", () => {
    expect(decode(encode({ t: "album-changed" }))).toEqual({ t: "album-changed" });
    expect(decode(encode({ t: "calendar-changed" }))).toEqual({ t: "calendar-changed" });
  });
});
