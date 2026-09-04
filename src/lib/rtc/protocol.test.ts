import { describe, it, expect } from "vitest";
import { encode, decode, MEME_IDS, type PeerMessage } from "./protocol";

describe("protocol", () => {
  const cases: PeerMessage[] = [
    { t: "hello", identity: "id-1", name: "Ben" },
    { t: "ping", t0: 1000 },
    { t: "pong", t0: 1000, t1: 1090 },
    { t: "meme", id: "heart", showAt: 1234567 },
  ];

  it.each(cases)("round-trips %o", (msg) => {
    expect(decode(encode(msg))).toEqual(msg);
  });

  it("returns null for non-JSON", () => {
    expect(decode("not json")).toBeNull();
  });

  it("returns null for an unknown message type", () => {
    expect(decode(JSON.stringify({ t: "explode" }))).toBeNull();
  });

  it("returns null when a required field is missing", () => {
    expect(decode(JSON.stringify({ t: "ping" }))).toBeNull();
    expect(decode(JSON.stringify({ t: "meme", id: "heart" }))).toBeNull();
  });

  it("returns null for an unknown meme id", () => {
    expect(decode(JSON.stringify({ t: "meme", id: "banana", showAt: 1 }))).toBeNull();
  });

  it("exposes the full gesture vocabulary", () => {
    expect([...MEME_IDS]).toEqual([
      "heart",
      "peace",
      "thumbsUp",
      "smile",
      "blowKiss",
      "handsOverMouth",
      "wink",
      "pray",
      "thumbsDown",
    ]);
  });

  it("has no duplicate ids", () => {
    expect(new Set(MEME_IDS).size).toBe(MEME_IDS.length);
  });
});

describe("card messages", () => {
  const card = {
    t: "card" as const,
    cardId: 42,
    text: "What did you think of me when we first met?",
    mood: "us" as const,
    showAt: 1_700_000_000_000,
  };

  it("round-trips a drawn card", () => {
    expect(decode(encode(card))).toEqual(card);
  });

  it("rejects an unknown mood", () => {
    // A mood outside the three would reach the UI and index nothing.
    expect(decode(JSON.stringify({ ...card, mood: "spicy" }))).toBeNull();
  });

  it("rejects a missing question", () => {
    expect(decode(JSON.stringify({ ...card, text: undefined }))).toBeNull();
  });

  it("rejects a non-numeric card id", () => {
    expect(decode(JSON.stringify({ ...card, cardId: "42" }))).toBeNull();
  });

  it("rejects a card without a showAt", () => {
    expect(decode(JSON.stringify({ ...card, showAt: undefined }))).toBeNull();
  });
});

describe("activity messages", () => {
  const msg = { t: "activity" as const, id: "movie" as const, showAt: 1_700_000 };

  it("round-trips an activity switch", () => {
    expect(decode(encode(msg))).toEqual(msg);
  });

  it("round-trips closing the activity", () => {
    const close = { t: "activity" as const, id: null, showAt: 1_700_000 };
    expect(decode(encode(close))).toEqual(close);
  });

  it("rejects an unknown activity", () => {
    // An id outside the registry would index nothing and blank the stage.
    expect(decode(JSON.stringify({ ...msg, id: "bowling" }))).toBeNull();
  });

  it("rejects an activity without a showAt", () => {
    expect(decode(JSON.stringify({ ...msg, showAt: undefined }))).toBeNull();
  });
});

describe("media messages", () => {
  const msg = {
    t: "media" as const,
    videoId: "dQw4w9WgXcQ",
    source: "youtube" as const,
    durationSec: null,
    positionSec: 42.5,
    playing: true,
    atSharedTime: 1_700_000,
  };

  it("round-trips playback state", () => {
    expect(decode(encode(msg))).toEqual(msg);
  });

  it("round-trips clearing the video", () => {
    const cleared = { ...msg, videoId: null, playing: false, positionSec: 0 };
    expect(decode(encode(cleared))).toEqual(cleared);
  });

  it("keeps a paused state distinct from a playing one", () => {
    // `playing` decides whether position advances with the clock, so losing it
    // would leave one side racing ahead of a stopped video.
    const paused = decode(encode({ ...msg, playing: false }));
    expect(paused).not.toBeNull();
    expect(paused && "playing" in paused && paused.playing).toBe(false);
  });

  it("rejects a state with no timestamp to anchor it", () => {
    expect(decode(JSON.stringify({ ...msg, atSharedTime: undefined }))).toBeNull();
  });

  it("rejects a non-boolean playing flag", () => {
    expect(decode(JSON.stringify({ ...msg, playing: "yes" }))).toBeNull();
  });

  it("rejects a non-numeric position", () => {
    expect(decode(JSON.stringify({ ...msg, positionSec: "42" }))).toBeNull();
  });
});

describe("where the film is coming from", () => {
  const base = {
    t: "media" as const,
    videoId: "dQw4w9WgXcQ",
    positionSec: 12,
    playing: true,
    atSharedTime: 1000,
  };

  it("carries a local film's source and length", () => {
    // The file itself never travels — a two-hour film is gigabytes and the
    // call moves a few hundred kilobytes a second. Only the length does, so
    // two copies can be checked against each other.
    const msg = decode(
      encode({ ...base, source: "local", durationSec: 7402.5, videoId: "Inception.mp4" }),
    );
    expect(msg).toMatchObject({ source: "local", durationSec: 7402.5 });
  });

  it("reads a message from before this field existed as YouTube", () => {
    // A peer on the previous build sends no source at all. Refusing the
    // message would break karaoke between mismatched versions.
    const msg = decode(JSON.stringify(base));
    expect(msg).toMatchObject({ source: "youtube", durationSec: null });
  });

  it("refuses to guess at a source it does not recognise", () => {
    const msg = decode(JSON.stringify({ ...base, source: "bittorrent" }));
    expect(msg).toMatchObject({ source: "youtube" });
  });

  it("drops a length that is not a number", () => {
    const msg = decode(JSON.stringify({ ...base, source: "local", durationSec: "long" }));
    expect(msg).toMatchObject({ durationSec: null });
  });

  it("still refuses a message missing the parts that matter", () => {
    expect(decode(JSON.stringify({ t: "media", source: "local" }))).toBeNull();
  });
});

describe("starting a photo booth sitting", () => {
  const shot = {
    t: "photo" as const,
    themeId: "planetarium" as const,
    shots: 4 as const,
    startAt: 1_700_000,
  };

  it("round-trips a sitting", () => {
    expect(decode(encode(shot))).toEqual(shot);
  });

  it("carries the instant both cameras fire from", () => {
    // The whole point. Both sides compute the same countdown from this one
    // number, which is what photographs you together rather than a third of a
    // second apart.
    const msg = decode(encode(shot));
    expect(msg).toMatchObject({ startAt: 1_700_000 });
  });

  it("refuses a theme that does not exist", () => {
    // It reaches a painter that would throw on an unknown id, mid-countdown.
    expect(decode(JSON.stringify({ ...shot, themeId: "sepia" }))).toBeNull();
  });

  it("refuses a shot count the strip cannot lay out", () => {
    expect(decode(JSON.stringify({ ...shot, shots: 3 }))).toBeNull();
    expect(decode(JSON.stringify({ ...shot, shots: 0 }))).toBeNull();
  });

  it("refuses a sitting with no start", () => {
    expect(decode(JSON.stringify({ ...shot, startAt: "soon" }))).toBeNull();
  });
});

describe("karaoke track messages", () => {
  const request = {
    t: "track-request" as const,
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    requestId: "request-1",
  };
  const meta = {
    t: "track-meta" as const,
    requestId: "request-1",
    title: "Never Gonna Give You Up",
    durationSec: 212,
    bytes: 5_242_880,
    chunks: 320,
    lrc: "[00:00.00]Never gonna give you up",
  };
  const done = { t: "track-done" as const, requestId: "request-1" };
  const error = {
    t: "track-error" as const,
    requestId: "request-1",
    message: "The helper could not fetch this track.",
  };

  it.each([request, meta, done, error])("round-trips %o", (msg) => {
    expect(decode(encode(msg))).toEqual(msg);
  });

  it("accepts metadata without synced lyrics", () => {
    // Missing timed lyrics do not make the audio unusable, so absence has its
    // own valid representation instead of looking like a broken transfer.
    expect(decode(encode({ ...meta, lrc: null }))).toEqual({ ...meta, lrc: null });
  });

  it("rejects a non-text lyric payload", () => {
    expect(decode(JSON.stringify({ ...meta, lrc: 42 }))).toBeNull();
  });

  it.each([
    [request, "url", 42],
    [request, "requestId", 42],
    [meta, "requestId", 42],
    [meta, "title", 42],
    [meta, "durationSec", "212"],
    [meta, "bytes", "5242880"],
    [meta, "chunks", "320"],
    [meta, "lrc", 42],
    [done, "requestId", 42],
    [error, "requestId", 42],
    [error, "message", 42],
  ] as const)("rejects %s with a missing or wrong-typed %s", (msg, field, wrongValue) => {
    const missing = { ...msg } as Record<string, unknown>;
    delete missing[field];
    expect(decode(JSON.stringify(missing))).toBeNull();
    expect(decode(JSON.stringify({ ...msg, [field]: wrongValue }))).toBeNull();
  });

  it("rejects an impossible transfer declaration", () => {
    expect(decode(JSON.stringify({ ...meta, chunks: 0 }))).toBeNull();
    expect(decode(JSON.stringify({ ...meta, bytes: -1 }))).toBeNull();
  });

  it("still rejects unknown message types", () => {
    expect(decode(JSON.stringify({ t: "track-progress" }))).toBeNull();
  });

  it("still rejects malformed JSON", () => {
    expect(decode('{"t":"track-meta"')).toBeNull();
  });
});
