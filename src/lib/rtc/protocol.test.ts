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
