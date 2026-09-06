import { describe, it, expect } from "vitest";
import { stagePlayer } from "./stagePlayer";

describe("stagePlayer", () => {
  it("THE BUG: a local song that has not arrived yet never reaches a YouTube player", () => {
    // Reported from a real call: the sender saw the video play, and the other
    // person saw "Video unavailable" and heard nothing. This is why. Their side
    // had no file, fell through to the YouTube player, and the sync layer fed
    // it the shared id -- which for a fetched track is the song's title.
    expect(stagePlayer({ activity: "karaoke", filmSource: "local", hasFile: false })).toBe(
      "waiting",
    );
  });

  it("shows the file once it has arrived", () => {
    expect(stagePlayer({ activity: "karaoke", filmSource: "local", hasFile: true })).toBe(
      "local",
    );
  });

  it("still embeds a YouTube link when that is what the room chose", () => {
    // The fallback path, for when no helper answered and the link is played as
    // a video on both sides.
    expect(stagePlayer({ activity: "karaoke", filmSource: "youtube", hasFile: false })).toBe(
      "youtube",
    );
  });

  it("offers YouTube before any song is chosen, since that is the way in", () => {
    expect(stagePlayer({ activity: "karaoke", filmSource: null, hasFile: false })).toBe(
      "youtube",
    );
  });

  it("THE RULE: no combination ever sends a local song to YouTube", () => {
    // The one guarantee worth stating over the whole cross product, because the
    // bug was a single missing condition in one branch of four.
    for (const activity of ["karaoke", "movie", "photobooth", "cards"]) {
      for (const filmSource of ["youtube", "local", null] as const) {
        for (const hasFile of [false, true]) {
          const result = stagePlayer({ activity, filmSource, hasFile });
          if (filmSource === "local") {
            expect(result, `${activity}/${filmSource}/${hasFile}`).not.toBe("youtube");
          }
        }
      }
    }
  });

  describe("movies, which are never sent between the two of you", () => {
    it("embeds a shared YouTube film", () => {
      expect(stagePlayer({ activity: "movie", filmSource: "youtube", hasFile: false })).toBe(
        "youtube",
      );
    });

    it("plays this side's own copy when it has been opened", () => {
      expect(stagePlayer({ activity: "movie", filmSource: "local", hasFile: true })).toBe(
        "local",
      );
    });

    it("shows nothing rather than waiting, because no bytes are coming", () => {
      // The difference from karaoke: a film is opened on each machine by hand,
      // so an absent one is a standing state and the panel is what asks for it.
      expect(stagePlayer({ activity: "movie", filmSource: "local", hasFile: false })).toBe(
        "none",
      );
    });
  });

  it("shows no player for activities that are not about playing something", () => {
    expect(stagePlayer({ activity: "photobooth", filmSource: null, hasFile: false })).toBe(
      "none",
    );
    expect(stagePlayer({ activity: "cards", filmSource: "youtube", hasFile: true })).toBe(
      "none",
    );
  });
});

describe("before an activity is chosen", () => {
  it("shows no player at all", () => {
    // `current` is null until someone picks an activity, and a null must not be
    // read as karaoke by falling through a truthiness check.
    expect(stagePlayer({ activity: null, filmSource: null, hasFile: false })).toBe("none");
    expect(stagePlayer({ activity: null, filmSource: "local", hasFile: true })).toBe("none");
  });
});
