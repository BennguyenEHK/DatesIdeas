import { describe, it, expect } from "vitest";
import {
  ACTIVITIES,
  ACTIVITY_IDS,
  activity,
  activityKey,
  isActivityId,
} from "./registry";

describe("activity registry", () => {
  it("has an entry for every id", () => {
    expect(ACTIVITIES.map((a) => a.id).sort()).toEqual([...ACTIVITY_IDS].sort());
  });

  it("has no duplicate ids", () => {
    expect(new Set(ACTIVITIES.map((a) => a.id)).size).toBe(ACTIVITIES.length);
  });

  it("gives every activity a label and an icon", () => {
    for (const a of ACTIVITIES) {
      expect(a.label.trim()).not.toBe("");
      expect(a.icon.trim()).not.toBe("");
    }
  });

  it("only uses the two known kinds", () => {
    for (const a of ACTIVITIES) {
      expect(["companion", "takeover"]).toContain(a.kind);
    }
  });

  it("marks exactly the built activities as ready", () => {
    // Guards against shipping a bubble that opens an empty stage. The photo
    // booth is the last one left; this list is what has to change with it.
    expect(ACTIVITIES.filter((a) => a.ready).map((a) => a.id)).toEqual([
      "cards",
      "karaoke",
      "movie",
    ]);
  });

  it("gives the frame only to what needs to be bigger than a face", () => {
    // A song and a film both want the frame, and both keep the faces beside
    // them. Cards and the photo booth ARE the faces, so they stay
    // companion-sized with the activity beneath.
    expect(ACTIVITIES.filter((a) => a.kind === "takeover").map((a) => a.id)).toEqual([
      "karaoke",
      "movie",
    ]);
  });

  it("recognises known ids and rejects anything else", () => {
    expect(isActivityId("movie")).toBe(true);
    expect(isActivityId("bowling")).toBe(false);
    expect(isActivityId(null)).toBe(false);
    expect(isActivityId(3)).toBe(false);
  });

  it("looks an activity up by id", () => {
    expect(activity("cards").kind).toBe("companion");
    expect(activity("movie").kind).toBe("takeover");
  });

  it("gives every activity a distinct, stable swap key", () => {
    // The keys break ties when both peers switch at the same instant, so they
    // must be unique or the tie-break is not deterministic.
    const keys = ACTIVITY_IDS.map(activityKey);
    expect(new Set(keys).size).toBe(keys.length);
    // -1 is reserved for "closed"; a real key must never collide with it.
    expect(keys.every((k) => k >= 0)).toBe(true);
  });
});
