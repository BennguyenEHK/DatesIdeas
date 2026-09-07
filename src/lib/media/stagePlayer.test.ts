import { describe, it, expect } from "vitest";
import { stagePlayer, holdsCurrentSong, songLanding } from "./stagePlayer";

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

describe("holdsCurrentSong", () => {
  it("THE BUG: a file left over from the last song does not count as this one", () => {
    // Reported from a real call. She loaded a new song; it appeared on her side
    // and the old one stayed on his, because his browser still held a file and
    // that was the only question being asked. Pressing play then started two
    // different songs at once, one on each side.
    expect(
      holdsCurrentSong({ ready: true, id: "Take Me Home" }, "Sweet Caroline"),
    ).toBe(false);
  });

  it("counts the song once the right one has arrived", () => {
    expect(
      holdsCurrentSong({ ready: true, id: "Sweet Caroline" }, "Sweet Caroline"),
    ).toBe(true);
  });

  it("does not count a file that is still being read", () => {
    expect(holdsCurrentSong({ ready: false, id: "Sweet Caroline" }, "Sweet Caroline")).toBe(
      false,
    );
  });

  it("does not count anything before the room has agreed on a song", () => {
    expect(holdsCurrentSong({ ready: true, id: "Sweet Caroline" }, null)).toBe(false);
  });

  it("never lets two nulls look like a match", () => {
    // Both sides idle is not both sides holding the same song, and treating it
    // as one would put an empty player on the stage.
    expect(holdsCurrentSong({ ready: true, id: null }, null)).toBe(false);
  });
});

describe("a song that has been asked for but has not arrived", () => {
  it("THE BUG: takes the previous song off the stage the moment a new one is asked for", () => {
    // Reported from a real call. She pasted a link; her helper spent half a
    // minute downloading it, and in all that time nothing at all had been sent
    // to him -- so his side went on showing, and offering to play, the song
    // before it. The first thing that could have told him was the film id, and
    // that is not broadcast until the download has already finished.
    expect(
      stagePlayer({
        activity: "karaoke",
        filmSource: "local",
        hasFile: true,
        songLoading: true,
      }),
    ).toBe("waiting");
  });

  it("leaves the stage alone once the song being loaded has landed", () => {
    expect(
      stagePlayer({
        activity: "karaoke",
        filmSource: "local",
        hasFile: true,
        songLoading: false,
      }),
    ).toBe("local");
  });

  it("never disturbs a film, which is not fetched for anyone", () => {
    expect(
      stagePlayer({
        activity: "movie",
        filmSource: "local",
        hasFile: true,
        songLoading: true,
      }),
    ).toBe("local");
  });
});

describe("songLanding", () => {
  const base = {
    karaoke: true,
    stage: "local" as const,
    sendingTo: null as string | null,
    receiving: false,
    loading: null as "here" | "there" | null,
  };

  it("THE BUG: locks the listener from the moment the other side asks for a song", () => {
    // The listener's play button stayed live through the whole download, over a
    // song that was about to be replaced.
    expect(songLanding({ ...base, loading: "there" })).toBe("there");
  });

  it("locks the side that asked, too, so neither can start it", () => {
    expect(songLanding({ ...base, stage: "waiting", loading: "here" })).toBe("here");
  });

  it("says the bytes are going out once the song is in hand here", () => {
    expect(songLanding({ ...base, sendingTo: "req-1" })).toBe("there");
  });

  it("prefers the outgoing send over a stale announcement", () => {
    // Both can be set for an instant while the fetch finishes and the push
    // begins. The push is the later truth.
    expect(songLanding({ ...base, sendingTo: "req-1", loading: "here" })).toBe("there");
  });

  it("says this side is waiting when it does not hold the current song", () => {
    expect(songLanding({ ...base, stage: "waiting" })).toBe("here");
  });

  it("THE FLICKER: bytes arriving here outrank the announcement that sent them", () => {
    // The announcement stays set until the song is actually in hand, so during
    // the transfer both are true. Reading the announcement first would tell the
    // person receiving the song that it was loading on the other computer, and
    // would hide the progress bar they can watch filling -- only the side the
    // bytes are arriving at can measure them.
    expect(
      songLanding({ ...base, stage: "waiting", receiving: true, loading: "there" }),
    ).toBe("here");
  });

  it("still says outgoing when this side is the one pushing", () => {
    expect(
      songLanding({ ...base, sendingTo: "req-1", receiving: false, loading: "here" }),
    ).toBe("there");
  });

  it("frees the transport when nothing is in flight", () => {
    expect(songLanding(base)).toBeNull();
  });

  it("never locks anything outside karaoke", () => {
    expect(
      songLanding({ ...base, karaoke: false, stage: "waiting", loading: "there" }),
    ).toBeNull();
  });
});
