import { describe, expect, it } from "vitest";
import { activityAnnouncement } from "./announce";

describe("activityAnnouncement", () => {
  it("says nothing when this side has never chosen an activity", () => {
    // A fresh page has no opinion. Sending "closed" here would pull a person
    // who is already in the album back out of it the moment you arrive.
    expect(activityAnnouncement(null)).toBeNull();
  });

  it("repeats the open activity with the moment it was chosen", () => {
    // The original showAt, not a new one: the newest choice has to win on the
    // other side, and restamping would make an old choice look new.
    expect(activityAnnouncement({ id: "album", showAt: 1_000 })).toEqual({
      t: "activity",
      id: "album",
      showAt: 1_000,
    });
  });

  it("repeats a close too, so a stale screen leaves the album", () => {
    expect(activityAnnouncement({ id: null, showAt: 2_000 })).toEqual({
      t: "activity",
      id: null,
      showAt: 2_000,
    });
  });
});
