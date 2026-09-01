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

  it("exposes exactly the four v1 meme ids", () => {
    expect([...MEME_IDS]).toEqual(["heart", "peace", "thumbsUp", "smile"]);
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
