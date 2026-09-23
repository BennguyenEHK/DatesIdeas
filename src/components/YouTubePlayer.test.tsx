import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import { createRef } from "react";
import { YouTubePlayer, type YouTubePlayerHandle } from "./YouTubePlayer";

/**
 * A stand-in for YouTube's IFrame API that does the one thing that matters
 * here: it REPLACES the element it is given with an iframe.
 *
 * That is the documented behaviour of the real API -- "the API will replace the
 * specified element with the <iframe> element" -- and it is the whole reason
 * these tests exist. A stub that merely appended a child would pass whatever
 * the component did and prove nothing.
 */
class FakePlayer {
  iframe: HTMLIFrameElement;
  /** The most recently constructed player, so a test can drive its events. */
  static last: FakePlayer | null = null;
  private readonly fire?: (event: { data: number }) => void;

  constructor(
    element: HTMLElement,
    options: {
      events?: {
        onReady?: () => void;
        onStateChange?: (event: { data: number }) => void;
      };
    },
  ) {
    this.iframe = document.createElement("iframe");
    element.replaceWith(this.iframe);
    this.fire = options.events?.onStateChange;
    FakePlayer.last = this;
    // Later, as the real API does. Called from inside the constructor, the
    // component would be told it is ready before it holds the player at all.
    queueMicrotask(() => {
      options.events?.onReady?.();
      this.ready = true;
    });
  }

  ready = false;

  /** Pretends YouTube changed state, which is how a real start is reported. */
  emit(data: number) {
    this.fire?.({ data });
  }

  destroy() {
    this.iframe.remove();
  }

  /** What the component asked of the player, in order. */
  calls: string[] = [];
  /** What getPlaylist answers; null until "YouTube" has read the list. */
  playlist: string[] | null = null;
  state = 5;

  playVideo() {
    this.calls.push("play");
  }
  pauseVideo() {}
  seekTo() {}
  loadVideoById() {}
  cueVideoById(id: string, start?: number) {
    this.calls.push(`cue:${id}@${start}`);
  }
  cuePlaylist(options: { list: string }) {
    this.calls.push(`cuePlaylist:${options.list}`);
  }
  getPlaylist() {
    return this.playlist;
  }
  getPlayerState() {
    return this.state;
  }
  getDuration() {
    return 246;
  }
  getCurrentTime() {
    return 0;
  }
  setVolume() {}
  setPlaybackRate() {}
  getAvailablePlaybackRates() {
    return [1];
  }
}

beforeEach(() => {
  (window as unknown as { YT: unknown }).YT = {
    Player: FakePlayer,
    PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0, BUFFERING: 3, CUED: 5 },
  };
});

/** Lets the resolved API promise and the onReady callback settle. */
async function settle() {
  await vi.waitFor(() => {
    expect(document.querySelector("iframe")).toBeTruthy();
    expect(FakePlayer.last?.ready).toBe(true);
  });
}

describe("YouTubePlayer and the node YouTube takes away", () => {
  it("THE BUG: unmounting after YouTube has swapped the node does not throw", async () => {
    // This is the crash reported from the room, verbatim:
    //   Failed to execute 'removeChild' on 'Node': The node to be removed is
    //   not a child of this node.
    // It happens the moment a fetched karaoke track becomes ready, because that
    // is when the panel swaps this player out for the local video one. React
    // tries to remove the div it rendered, and the div is gone -- YouTube
    // replaced it with an iframe the moment the player was constructed.
    const view = render(
      <div>
        <YouTubePlayer />
      </div>,
    );
    await settle();

    expect(() => view.unmount()).not.toThrow();
  });

  it("hands YouTube a node React does not own", async () => {
    // The fix, stated as a property rather than as an implementation: whatever
    // element is sacrificed to the API, it must not be one React is tracking,
    // because React will later try to remove exactly that element.
    const view = render(<YouTubePlayer />);
    await settle();

    // React rendered a wrapper; the iframe must sit inside it rather than
    // having taken its place.
    const wrapper = view.container.firstElementChild;
    expect(wrapper).toBeTruthy();
    expect(wrapper?.querySelector("iframe")).toBeTruthy();
  });

  it("survives the swap that actually happens in the room", async () => {
    // Rendered, then replaced by a sibling -- the karaoke panel's exact move
    // when a track finishes loading and ownTrack flips true.
    function Stage({ own }: { own: boolean }) {
      return <div>{own ? <video data-testid="local" /> : <YouTubePlayer />}</div>;
    }

    const view = render(<Stage own={false} />);
    await settle();

    expect(() => view.rerender(<Stage own />)).not.toThrow();
    expect(view.getByTestId("local")).toBeTruthy();
  });

  it("leaves nothing behind when it goes", async () => {
    const view = render(<YouTubePlayer />);
    await settle();
    view.unmount();
    expect(view.container.querySelector("iframe")).toBeNull();
  });
});

/**
 * Why this matters: the sync layer stamps a position when play() is CALLED, and
 * YouTube does not begin at that instant. Until the real start was reported,
 * the whole start-up delay went unmeasured until the drift timer came round --
 * by which point it was large enough to be answered with a seek, which is the
 * film visibly jumping backwards and throwing away the buffer it just filled.
 */
describe("reporting a genuine start", () => {
  it("tells the sync layer the moment playback actually begins", async () => {
    const onStarted = vi.fn();
    render(<YouTubePlayer onStarted={onStarted} />);
    await settle();

    FakePlayer.last?.emit(1); // PLAYING
    expect(onStarted).toHaveBeenCalledOnce();
  });

  it("says nothing when the film is merely paused or ended", async () => {
    const onStarted = vi.fn();
    render(<YouTubePlayer onStarted={onStarted} />);
    await settle();

    FakePlayer.last?.emit(2); // PAUSED
    FakePlayer.last?.emit(0); // ENDED
    expect(onStarted).not.toHaveBeenCalled();
  });

  it("reports a start once, however many times YouTube announces one", async () => {
    // The loop this guards: a correction seeks, YouTube answers the seek with
    // another PLAYING, and reporting that as a fresh start asks for another
    // correction, which seeks again.
    const onStarted = vi.fn();
    render(<YouTubePlayer onStarted={onStarted} />);
    await settle();

    FakePlayer.last?.emit(1);
    FakePlayer.last?.emit(1);
    FakePlayer.last?.emit(1);
    expect(onStarted).toHaveBeenCalledOnce();
  });

  it("still reports the play/pause state on every change", async () => {
    // onStarted is debounced; onStateChange deliberately is not. They answer
    // different questions and must not be collapsed into one.
    const onStateChange = vi.fn();
    render(<YouTubePlayer onStateChange={onStateChange} />);
    await settle();

    FakePlayer.last?.emit(1);
    FakePlayer.last?.emit(2);
    expect(onStateChange).toHaveBeenNthCalledWith(1, true);
    expect(onStateChange).toHaveBeenNthCalledWith(2, false);
  });
});

/**
 * The music queue moves on when a song ends. YouTube is free to announce the
 * same ending more than once, and every extra report would skip a song.
 */
describe("reporting the end of a video", () => {
  it("reports an ending once, with the video that ended", async () => {
    const onEnded = vi.fn();
    const ref = createRef<YouTubePlayerHandle>();
    render(<YouTubePlayer ref={ref} onEnded={onEnded} />);
    await settle();

    ref.current?.load("aaaaaaaaaaa", 0);
    FakePlayer.last?.emit(1); // PLAYING
    FakePlayer.last?.emit(0); // ENDED
    FakePlayer.last?.emit(0); // ENDED again
    expect(onEnded).toHaveBeenCalledOnce();
    expect(onEnded).toHaveBeenCalledWith("aaaaaaaaaaa");
  });

  it("reports the next ending after playback starts again", async () => {
    const onEnded = vi.fn();
    render(<YouTubePlayer onEnded={onEnded} />);
    await settle();

    FakePlayer.last?.emit(0);
    FakePlayer.last?.emit(1);
    FakePlayer.last?.emit(0);
    expect(onEnded).toHaveBeenCalledTimes(2);
  });

  it("does not treat a pause as an ending", async () => {
    const onEnded = vi.fn();
    render(<YouTubePlayer onEnded={onEnded} />);
    await settle();

    FakePlayer.last?.emit(2);
    expect(onEnded).not.toHaveBeenCalled();
  });
});

describe("reading a playlist", () => {
  it("returns the playlist's ids and puts the song that was playing back", async () => {
    const ref = createRef<YouTubePlayerHandle>();
    render(<YouTubePlayer ref={ref} />);
    await settle();
    vi.useFakeTimers();
    try {
      ref.current?.load("aaaaaaaaaaa", 30);
      const fake = FakePlayer.last!;
      fake.state = 1; // PLAYING
      const pending = ref.current!.expandPlaylist("PLlist");
      expect(fake.calls).toContain("cuePlaylist:PLlist");

      // The sync layer keeps talking while the list is read. Nothing it says
      // may reach a player that is showing the playlist.
      fake.calls.length = 0;
      ref.current?.play();
      ref.current?.seek(42);
      expect(fake.calls).toEqual([]);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });
      fake.playlist = ["bbbbbbbbbbb", "ccccccccccc"];
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });

      expect(await pending).toEqual(["bbbbbbbbbbb", "ccccccccccc"]);
      expect(fake.calls).toEqual(["cue:aaaaaaaaaaa@42", "play"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up with nothing after five seconds", async () => {
    const ref = createRef<YouTubePlayerHandle>();
    render(<YouTubePlayer ref={ref} />);
    await settle();
    vi.useFakeTimers();
    try {
      let settled = false;
      const pending = ref.current!.expandPlaylist("PLprivate");
      void pending.then(() => {
        settled = true;
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4750);
      });
      expect(settled).toBe(false);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });
      expect(await pending).toEqual([]);
      // Nothing was cued before, so there is nothing to put back.
      expect(FakePlayer.last?.calls.some((c) => c.startsWith("cue:"))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports how long the video is once YouTube knows", async () => {
    const ref = createRef<YouTubePlayerHandle>();
    render(<YouTubePlayer ref={ref} />);
    await settle();
    expect(ref.current?.duration()).toBe(246);
  });
});
