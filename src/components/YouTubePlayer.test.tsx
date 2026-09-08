import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { YouTubePlayer } from "./YouTubePlayer";

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
    options.events?.onReady?.();
  }

  /** Pretends YouTube changed state, which is how a real start is reported. */
  emit(data: number) {
    this.fire?.({ data });
  }

  destroy() {
    this.iframe.remove();
  }

  playVideo() {}
  pauseVideo() {}
  seekTo() {}
  loadVideoById() {}
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
    PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0 },
  };
});

/** Lets the resolved API promise and the onReady callback settle. */
async function settle() {
  await vi.waitFor(() => {
    expect(document.querySelector("iframe")).toBeTruthy();
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
