import { describe, expect, it } from "vitest";
import { MUSIC_QUEUE_MAX, type MusicTrack } from "@/lib/rtc/protocol";
import {
  EMPTY_MUSIC,
  acceptRemote,
  addTracks,
  currentTrack,
  jumpTo,
  next,
  previous,
  removeAt,
  setTitles,
  stop,
  toMessage,
  type MusicState,
} from "./queue";

const track = (videoId: string, addedBy = "me"): MusicTrack => ({
  videoId,
  title: null,
  addedBy,
});

const A = track("aaaaaaaaaaa");
const B = track("bbbbbbbbbbb");
const C = track("ccccccccccc");

function queueOf(index: number | null, revision = 3, sentAt = 100): MusicState {
  return { queue: [A, B, C], index, revision, sentAt };
}

describe("addTracks", () => {
  it("starts an empty queue at its first track", () => {
    const state = addTracks(EMPTY_MUSIC, [A, B]);
    expect(state.queue).toEqual([A, B]);
    expect(state.index).toBe(0);
    expect(state.revision).toBe(1);
  });

  it("appends without moving the playing track", () => {
    const state = addTracks(
      { ...EMPTY_MUSIC, queue: [A, B], index: 1, revision: 4 },
      [C],
    );
    expect(state.queue).toEqual([A, B, C]);
    expect(state.index).toBe(1);
    expect(state.revision).toBe(5);
  });

  it("drops tracks past the protocol's limit rather than sending a list the peer refuses", () => {
    const full = Array.from({ length: MUSIC_QUEUE_MAX }, () => A);
    const state = { ...EMPTY_MUSIC, queue: full, index: 0, revision: 2 };
    expect(addTracks(state, [B])).toBe(state);
    const nearly = { ...state, queue: full.slice(1) };
    expect(addTracks(nearly, [B, C]).queue).toHaveLength(MUSIC_QUEUE_MAX);
  });

  it("changes nothing when given nothing", () => {
    expect(addTracks(EMPTY_MUSIC, [])).toBe(EMPTY_MUSIC);
  });
});

describe("removeAt", () => {
  it("shifts the index back when a track before it goes", () => {
    const state = removeAt(queueOf(2), 0);
    expect(state.queue).toEqual([B, C]);
    expect(state.index).toBe(1);
    expect(currentTrack(state)).toBe(C);
    expect(state.revision).toBe(4);
  });

  it("leaves the index alone when a track after it goes", () => {
    const state = removeAt(queueOf(0), 2);
    expect(state.queue).toEqual([A, B]);
    expect(state.index).toBe(0);
  });

  it("hands the playing track's place to the one after it", () => {
    const state = removeAt(queueOf(1), 1);
    expect(state.queue).toEqual([A, C]);
    expect(state.index).toBe(1);
    expect(currentTrack(state)).toBe(C);
  });

  it("falls back to the one before when the playing track was last", () => {
    const state = removeAt(queueOf(2), 2);
    expect(state.queue).toEqual([A, B]);
    expect(state.index).toBe(1);
  });

  it("empties to no index at all", () => {
    const state = removeAt(
      { ...EMPTY_MUSIC, queue: [A], index: 0, revision: 1 },
      0,
    );
    expect(state.queue).toEqual([]);
    expect(state.index).toBeNull();
    expect(state.revision).toBe(2);
  });

  it("ignores a position that is not in the queue", () => {
    const state = queueOf(0);
    expect(removeAt(state, 3)).toBe(state);
    expect(removeAt(state, -1)).toBe(state);
  });
});

describe("jumpTo", () => {
  it("moves to the chosen track", () => {
    const state = jumpTo(queueOf(0), 2);
    expect(state.index).toBe(2);
    expect(state.revision).toBe(4);
  });

  it("does not bump the revision for the track already playing", () => {
    const state = queueOf(1);
    expect(jumpTo(state, 1)).toBe(state);
  });

  it("starts a queue that had nothing chosen", () => {
    expect(jumpTo(queueOf(null), 0).index).toBe(0);
  });

  it("ignores a position that is not in the queue", () => {
    const state = queueOf(0);
    expect(jumpTo(state, 5)).toBe(state);
  });
});

describe("next and previous", () => {
  it("move one track either way", () => {
    expect(next(queueOf(0)).index).toBe(1);
    expect(previous(queueOf(2)).index).toBe(1);
  });

  it("stop at the ends instead of wrapping, without bumping the revision", () => {
    const last = queueOf(2);
    const first = queueOf(0);
    expect(next(last)).toBe(last);
    expect(previous(first)).toBe(first);
  });

  it("do nothing when nothing is chosen", () => {
    const idle = queueOf(null);
    expect(next(idle)).toBe(idle);
    expect(previous(idle)).toBe(idle);
  });

  it("makes the second of two song-ended moves a no-op", () => {
    // Both screens see the song end and both ask to move on from track 0. The
    // second request must not skip track 1, which nobody has heard yet.
    const once = next(queueOf(0), 0);
    expect(once.index).toBe(1);
    expect(next(once, 0)).toBe(once);
  });
});

describe("stop", () => {
  it("keeps the list and plays nothing", () => {
    const state = stop(queueOf(1));
    expect(state.queue).toEqual([A, B, C]);
    expect(state.index).toBeNull();
    expect(state.revision).toBe(4);
  });

  it("changes nothing when nothing was playing", () => {
    const idle = queueOf(null);
    expect(stop(idle)).toBe(idle);
  });
});

describe("setTitles", () => {
  it("fills in titles still showing their id, once", () => {
    const state = setTitles(queueOf(0), { aaaaaaaaaaa: "Điều Anh Biết" });
    expect(state.queue[0].title).toBe("Điều Anh Biết");
    expect(state.queue[1].title).toBeNull();
    expect(state.revision).toBe(4);
  });

  it("leaves a title that already arrived alone", () => {
    const titled = setTitles(queueOf(0), { aaaaaaaaaaa: "First" });
    expect(setTitles(titled, { aaaaaaaaaaa: "Second" })).toBe(titled);
  });

  it("shortens a title the protocol would refuse", () => {
    const state = setTitles(queueOf(0), { aaaaaaaaaaa: "x".repeat(300) });
    expect(state.queue[0].title).toHaveLength(200);
  });
});

describe("acceptRemote", () => {
  const incoming = (revision: number, sentAt: number) =>
    toMessage({ queue: [C], index: 0, revision, sentAt }, sentAt);

  it("takes a higher revision whatever its time", () => {
    const state = acceptRemote(queueOf(0, 3, 500), incoming(4, 10));
    expect(state.queue).toEqual([C]);
    expect(state.revision).toBe(4);
    expect(state.sentAt).toBe(10);
  });

  it("keeps the local list against a lower revision", () => {
    const local = queueOf(0, 3, 10);
    expect(acceptRemote(local, incoming(2, 500))).toBe(local);
  });

  it("breaks a revision tie with the later change", () => {
    expect(acceptRemote(queueOf(0, 3, 100), incoming(3, 101)).queue).toEqual([
      C,
    ]);
    const local = queueOf(0, 3, 101);
    expect(acceptRemote(local, incoming(3, 100))).toBe(local);
  });

  it("keeps the local list on a full tie", () => {
    const local = queueOf(0, 3, 100);
    expect(acceptRemote(local, incoming(3, 100))).toBe(local);
  });
});

describe("toMessage", () => {
  it("carries the whole state with the time it was sent", () => {
    expect(toMessage(queueOf(1), 250)).toEqual({
      t: "music",
      queue: [A, B, C],
      index: 1,
      revision: 3,
      sentAt: 250,
    });
  });
});
