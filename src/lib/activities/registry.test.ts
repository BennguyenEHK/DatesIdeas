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
    // Guards against shipping a bubble that opens an empty stage. All four
    // are built now, so this is the test that has to change first if a fifth
    // bubble is ever added ahead of the thing behind it.
    expect(ACTIVITIES.every((a) => a.ready)).toBe(true);
  });

  it("gives the frame to whatever the faces have to sit inside", () => {
    // A song and a film both want the frame with the faces beside them. The
    // photo booth wants it for the opposite reason: the scene the two of you
    // stand in IS the stage, so the faces are inside the frame rather than
    // next to it. Only cards leaves the faces at full size with the activity
    // underneath.
    expect(ACTIVITIES.filter((a) => a.kind === "takeover").map((a) => a.id)).toEqual([
      "karaoke",
      "movie",
      "photobooth",
    ]);
    expect(ACTIVITIES.filter((a) => a.kind === "companion").map((a) => a.id)).toEqual([
      "cards",
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
