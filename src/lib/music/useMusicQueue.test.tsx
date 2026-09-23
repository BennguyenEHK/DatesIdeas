import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PeerMessage } from "@/lib/rtc/protocol";
import {
  useMusicControls,
  useMusicQueue,
  type MusicPlayback,
} from "./useMusicQueue";

type MusicMessage = Extract<PeerMessage, { t: "music" }>;

const A = "aaaaaaaaaaa";
const B = "bbbbbbbbbbb";
const C = "ccccccccccc";

function setup() {
  const sent: PeerMessage[] = [];
  const send = vi.fn((message: PeerMessage) => void sent.push(message));
  let clock = 1000;
  const now = () => clock;
  const hook = renderHook(() => useMusicQueue({ send, identity: "me", now }));
  return {
    hook,
    sent,
    tick: (ms: number) => {
      clock += ms;
    },
  };
}

const lastMusic = (sent: PeerMessage[]) =>
  [...sent].reverse().find((m) => m.t === "music") as MusicMessage | undefined;

beforeEach(() => {
  // Titles are looked up after every add. Answered with "not found" unless a
  // test says otherwise, so no test waits on a network.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("", { status: 404 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useMusicQueue", () => {
  it("adds songs here and sends the whole queue", () => {
    const { hook, sent } = setup();
    act(() => void hook.result.current.add([A, B]));

    expect(hook.result.current.state.queue.map((t) => t.videoId)).toEqual([
      A,
      B,
    ]);
    expect(hook.result.current.state.index).toBe(0);
    expect(sent).toEqual([
      {
        t: "music",
        queue: [
          { videoId: A, title: null, addedBy: "me" },
          { videoId: B, title: null, addedBy: "me" },
        ],
        index: 0,
        revision: 1,
        sentAt: 1000,
      },
    ]);
  });

  it("sends nothing for a change that changes nothing", () => {
    const { hook, sent } = setup();
    act(() => void hook.result.current.add([A]));
    sent.length = 0;

    act(() => void hook.result.current.next());
    act(() => void hook.result.current.previous());
    act(() => void hook.result.current.jump(0));
    expect(sent).toEqual([]);
    expect(hook.result.current.state.revision).toBe(1);
  });

  it("removes, jumps, moves on and stops, sending each", () => {
    const { hook, sent } = setup();
    act(() => void hook.result.current.add([A, B, C]));

    act(() => void hook.result.current.next());
    expect(lastMusic(sent)?.index).toBe(1);
    act(() => void hook.result.current.jump(2));
    expect(lastMusic(sent)?.index).toBe(2);
    act(() => void hook.result.current.previous());
    expect(lastMusic(sent)?.index).toBe(1);
    act(() => void hook.result.current.remove(0));
    expect(lastMusic(sent)?.queue.map((t) => t.videoId)).toEqual([B, C]);
    expect(lastMusic(sent)?.index).toBe(0);
    act(() => void hook.result.current.stop());
    expect(lastMusic(sent)?.index).toBeNull();
    expect(hook.result.current.state.queue).toHaveLength(2);
  });

  it("follows the other screen without sending it back", () => {
    const { hook, sent } = setup();
    act(() =>
      hook.result.current.accept({
        t: "music",
        queue: [{ videoId: C, title: "Theirs", addedBy: "them" }],
        index: 0,
        revision: 5,
        sentAt: 900,
      }),
    );
    expect(hook.result.current.state.queue[0].title).toBe("Theirs");
    expect(hook.result.current.state.revision).toBe(5);
    expect(sent).toEqual([]);

    // The next change here builds on theirs.
    act(() => void hook.result.current.add([A]));
    expect(lastMusic(sent)?.revision).toBe(6);
    expect(lastMusic(sent)?.queue.map((t) => t.videoId)).toEqual([C, A]);
  });

  it("keeps its own queue against an older one", () => {
    const { hook } = setup();
    act(() => void hook.result.current.add([A]));
    act(() => void hook.result.current.add([B]));
    act(() =>
      hook.result.current.accept({
        t: "music",
        queue: [],
        index: null,
        revision: 1,
        sentAt: 5000,
      }),
    );
    expect(hook.result.current.state.queue).toHaveLength(2);
  });

  it("ignores messages that are not about music", () => {
    const { hook } = setup();
    act(() => hook.result.current.accept({ t: "album-changed" }));
    expect(hook.result.current.state.revision).toBe(0);
  });

  it("tells a rejoining screen the queue, but only when there is one", () => {
    const { hook, sent } = setup();
    act(() => hook.result.current.resync());
    expect(sent).toEqual([]);

    act(() => void hook.result.current.add([A]));
    sent.length = 0;
    act(() => hook.result.current.resync());
    expect(sent).toHaveLength(1);
    expect(lastMusic(sent)?.revision).toBe(1);
  });

  it("looks the titles up and sends the queue once more with them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const id = new URL(url, "http://localhost").searchParams.get("videoId");
        return new Response(
          JSON.stringify({ title: `Song ${id}`, author: "Someone" }),
          {
            status: 200,
          },
        );
      }),
    );
    const { hook, sent } = setup();
    act(() => void hook.result.current.add(["ttttttttttA", "ttttttttttB"]));
    expect(sent).toHaveLength(1);

    await waitFor(() => expect(sent).toHaveLength(2));
    expect(lastMusic(sent)?.queue.map((t) => t.title)).toEqual([
      "Song ttttttttttA",
      "Song ttttttttttB",
    ]);
    expect(hook.result.current.state.queue[0].title).toBe("Song ttttttttttA");
  });

  it("stamps each change with the shared clock", () => {
    const { hook, sent, tick } = setup();
    act(() => void hook.result.current.add([A, B]));
    tick(250);
    act(() => void hook.result.current.next());
    expect(lastMusic(sent)?.sentAt).toBe(1250);
  });
});

/** A playback stand-in that records what the controls asked of it. */
function fakePlayback(videoId: string | null = null, playing = false) {
  const calls: string[] = [];
  const playback: MusicPlayback = {
    videoId,
    playing,
    load: (film, start) => {
      calls.push(`load:${film.videoId}@${start}`);
      playback.videoId = film.videoId;
    },
    playPause: () => calls.push("playPause"),
    seek: (s) => calls.push(`seek:${s}`),
    clear: () => {
      calls.push("clear");
      playback.videoId = null;
    },
  };
  return { playback, calls };
}

describe("useMusicControls", () => {
  function controls(playback: MusicPlayback, position = 30) {
    const queue = setup();
    const hook = renderHook(() =>
      useMusicControls(queue.hook.result.current, playback, () => position),
    );
    return { queue, controls: () => hook.result.current };
  }

  it("starts the first song of the evening by itself", () => {
    const { playback, calls } = fakePlayback();
    const { controls: c } = controls(playback);
    act(() => c().onAdd([A]));
    expect(calls).toEqual([`load:${A}@0`, "playPause"]);
  });

  it("lets later songs wait their turn", () => {
    const { playback, calls } = fakePlayback();
    const { controls: c } = controls(playback);
    act(() => c().onAdd([A]));
    calls.length = 0;
    act(() => c().onAdd([B]));
    expect(calls).toEqual([]);
  });

  it("plays a song chosen from the list", () => {
    const { playback, calls } = fakePlayback();
    const { controls: c } = controls(playback);
    act(() => c().onAdd([A, B, C]));
    calls.length = 0;
    act(() => c().onJump(2));
    expect(calls).toEqual([`load:${C}@0`, "playPause"]);
  });

  it("moves on when a song ends, once, however many screens say so", () => {
    const { playback, calls } = fakePlayback();
    const { queue, controls: c } = controls(playback);
    act(() => c().onAdd([A, B, C]));
    calls.length = 0;

    act(() => c().onEnded(A));
    expect(calls).toEqual([`load:${B}@0`, "playPause"]);
    // The other screen's report of the same ending arrives late.
    act(() => c().onEnded(A));
    expect(queue.hook.result.current.state.index).toBe(1);
    expect(calls).toHaveLength(2);
  });

  it("stays on the last song when it ends", () => {
    const { playback, calls } = fakePlayback();
    const { queue, controls: c } = controls(playback);
    act(() => c().onAdd([A]));
    calls.length = 0;
    act(() => c().onEnded(A));
    expect(calls).toEqual([]);
    expect(queue.hook.result.current.state.index).toBe(0);
  });

  it("skips ten seconds from where the song is", () => {
    const { playback, calls } = fakePlayback(A, true);
    const { controls: c } = controls(playback, 42);
    act(() => c().onSeekBy(10));
    act(() => c().onSeekBy(-10));
    expect(calls).toEqual(["seek:52", "seek:32"]);
  });

  it("keeps playing across next and previous only if it was playing", () => {
    const { playback, calls } = fakePlayback();
    const { controls: c } = controls(playback);
    act(() => c().onAdd([A, B]));
    playback.playing = false;
    calls.length = 0;
    act(() => c().onNext());
    expect(calls).toEqual([`load:${B}@0`]);
    playback.playing = true;
    calls.length = 0;
    act(() => c().onPrevious());
    expect(calls).toEqual([`load:${A}@0`, "playPause"]);
  });

  it("clears the player when the last song is removed", () => {
    const { playback, calls } = fakePlayback();
    const { controls: c } = controls(playback);
    act(() => c().onAdd([A]));
    calls.length = 0;
    act(() => c().onRemove(0));
    expect(calls).toEqual(["clear"]);
  });

  it("starts a resting queue from the top on play", () => {
    const { playback, calls } = fakePlayback();
    const { queue, controls: c } = controls(playback);
    act(() => c().onAdd([A, B]));
    act(() => void queue.hook.result.current.stop());
    playback.videoId = null;
    calls.length = 0;

    act(() => c().onPlayPause());
    expect(queue.hook.result.current.state.index).toBe(0);
    expect(calls).toEqual([`load:${A}@0`, "playPause"]);
  });

  it("plays and pauses the loaded song", () => {
    const { playback, calls } = fakePlayback(A, true);
    const { controls: c } = controls(playback);
    act(() => c().onPlayPause());
    expect(calls).toEqual(["playPause"]);
  });
});
