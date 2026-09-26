import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PeerMessage } from "@/lib/rtc/protocol";
import {
  useMusicControls,
  useMusicQueue,
  type MusicPlayback,
} from "@/lib/music/useMusicQueue";
import type { MusicState } from "@/lib/music/queue";
import { MusicBar, type MusicBarProps } from "./MusicBar";

/**
 * The bar's player, without YouTube.
 *
 * `expandPlaylist` answers with whatever the test puts in `playlistAnswer`.
 * `mounts` counts players built, which is how "no player until the first
 * song" is observed.
 */
const fakePlayer = vi.hoisted(() => ({
  playlistAnswer: [] as string[],
  expanded: [] as string[],
  mounts: 0,
}));

vi.mock("./YouTubePlayer", () => ({
  YouTubePlayer: forwardRef(function FakeYouTubePlayer(
    { onReady }: { onReady?: () => void },
    ref,
  ) {
    const [ready, setReady] = useState(false);
    useImperativeHandle(ref, () => ({
      isReady: () => ready,
      load: () => {},
      play: () => {},
      pause: () => {},
      seek: () => {},
      nudge: () => {},
      setRate: () => false,
      setVolume: () => {},
      currentTime: () => 0,
      duration: () => null,
      expandPlaylist: async (listId: string) => {
        fakePlayer.expanded.push(listId);
        return fakePlayer.playlistAnswer;
      },
    }));
    useEffect(() => {
      fakePlayer.mounts += 1;
      // Ready a moment later, as YouTube is.
      const timer = setTimeout(() => setReady(true), 0);
      return () => clearTimeout(timer);
    }, []);
    useEffect(() => {
      if (ready) onReady?.();
    }, [ready, onReady]);
    return <div data-testid="youtube-player" />;
  }),
}));

const A = "aaaaaaaaaaa";
const B = "bbbbbbbbbbb";
const C = "ccccccccccc";

function state(
  ids: string[],
  index: number | null,
  addedBy = "me",
): MusicState {
  return {
    queue: ids.map((videoId, i) => ({
      videoId,
      title: `Song ${i + 1}`,
      addedBy,
    })),
    index,
    revision: 1,
    sentAt: 0,
  };
}

function props(overrides: Partial<MusicBarProps> = {}): MusicBarProps {
  return {
    queue: state([], null),
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    onJump: vi.fn(),
    onNext: vi.fn(),
    onPrevious: vi.fn(),
    onPlayPause: vi.fn(),
    onSeekBy: vi.fn(),
    playing: false,
    positionSec: () => 0,
    durationSec: null,
    volume: 60,
    onVolume: vi.fn(),
    identity: "me",
    names: { you: "you", them: "K" },
    ...overrides,
  };
}

beforeEach(() => {
  fakePlayer.playlistAnswer = [];
  fakePlayer.expanded = [];
  fakePlayer.mounts = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("", { status: 404 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function openLinkField() {
  fireEvent.click(screen.getByRole("button", { name: "+ song" }));
  return screen.getByPlaceholderText("Search a song or paste a YouTube link");
}

describe("MusicBar when nothing is queued", () => {
  it("offers only the invitation and the link button, with no player", () => {
    render(<MusicBar {...props()} />);
    expect(
      screen.getByText("Search or paste a song to play music for both of you"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "+ song" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Play music" })).toBeNull();
    expect(screen.queryByTestId("youtube-player")).toBeNull();
    expect(fakePlayer.mounts).toBe(0);
  });
});

describe("adding songs", () => {
  /** The bar wired to the real queue, as the room wires it. */
  function Wired({ sent }: { sent: PeerMessage[] }) {
    const music = useMusicQueue({
      send: (m) => void sent.push(m),
      identity: "me",
      now: () => 1000,
    });
    const playback: MusicPlayback = {
      videoId: null,
      playing: false,
      load: () => {},
      playPause: () => {},
      seek: () => {},
      clear: () => {},
    };
    const controls = useMusicControls(music, playback, () => 0);
    return <MusicBar {...props({ queue: music.state, ...controls })} />;
  }

  it("appends a pasted video and sends the queue", () => {
    const sent: PeerMessage[] = [];
    render(<Wired sent={sent} />);
    const field = openLinkField();

    fireEvent.paste(field, {
      clipboardData: { getData: () => `https://youtu.be/${A}` },
    });

    expect(sent).toHaveLength(1);
    const message = sent[0] as Extract<PeerMessage, { t: "music" }>;
    expect(message.t).toBe("music");
    expect(message.queue.map((t) => t.videoId)).toEqual([A]);
    // The song is on the bar, shown by its id until the title arrives.
    expect(screen.getByText(A)).toBeTruthy();
    expect((field as HTMLInputElement).value).toBe("");
  });

  it("adds on Enter as well", () => {
    const onAdd = vi.fn();
    render(<MusicBar {...props({ onAdd })} />);
    const field = openLinkField();
    fireEvent.change(field, {
      target: { value: `https://www.youtube.com/watch?v=${B}` },
    });
    fireEvent.submit(field.closest("form")!);
    expect(onAdd).toHaveBeenCalledWith([B]);
  });

  it("says so when the link is not YouTube, and keeps the text", () => {
    const onAdd = vi.fn();
    render(<MusicBar {...props({ onAdd })} />);
    const field = openLinkField();
    fireEvent.change(field, { target: { value: "https://vimeo.com/12345" } });
    fireEvent.submit(field.closest("form")!);

    expect(screen.getByRole("alert").textContent).toBe(
      "That’s not a YouTube link",
    );
    expect((field as HTMLInputElement).value).toBe("https://vimeo.com/12345");
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("reads a playlist with a player mounted for it, then adds its songs", async () => {
    fakePlayer.playlistAnswer = [A, B, C];
    const onAdd = vi.fn();
    render(<MusicBar {...props({ onAdd })} />);
    const field = openLinkField();
    fireEvent.change(field, {
      target: { value: "https://www.youtube.com/playlist?list=PLabc" },
    });
    fireEvent.submit(field.closest("form")!);

    // The queue is empty, so the player is mounted just to read the list.
    expect(screen.getByTestId("youtube-player")).toBeTruthy();
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith([A, B, C]));
    expect(fakePlayer.expanded).toEqual(["PLabc"]);
  });

  it("reads a playlist with the player already playing", async () => {
    fakePlayer.playlistAnswer = [B];
    const onAdd = vi.fn();
    render(<MusicBar {...props({ onAdd, queue: state([A], 0) })} />);
    // Let the existing player become ready first.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const field = openLinkField();
    fireEvent.change(field, {
      target: { value: "https://www.youtube.com/playlist?list=PLxyz" },
    });
    fireEvent.submit(field.closest("form")!);

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith([B]));
    expect(fakePlayer.mounts).toBe(1);
  });

  it("says so when a playlist cannot be read", async () => {
    fakePlayer.playlistAnswer = [];
    const onAdd = vi.fn();
    render(<MusicBar {...props({ onAdd })} />);
    const field = openLinkField();
    fireEvent.change(field, {
      target: { value: "https://www.youtube.com/playlist?list=PLprivate" },
    });
    fireEvent.submit(field.closest("form")!);

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "Couldn’t read that playlist",
      ),
    );
    expect(onAdd).not.toHaveBeenCalled();
  });
});

describe("the controls", () => {
  it("each call the operation they are named for", () => {
    const p = props({ queue: state([A, B, C], 1) });
    render(<MusicBar {...p} />);

    fireEvent.click(screen.getByRole("button", { name: "Previous song" }));
    fireEvent.click(screen.getByRole("button", { name: "Back 10 seconds" }));
    fireEvent.click(screen.getByRole("button", { name: "Play music" }));
    fireEvent.click(screen.getByRole("button", { name: "Forward 10 seconds" }));
    fireEvent.click(screen.getByRole("button", { name: "Next song" }));

    expect(p.onPrevious).toHaveBeenCalledOnce();
    expect(p.onSeekBy).toHaveBeenNthCalledWith(1, -10);
    expect(p.onPlayPause).toHaveBeenCalledOnce();
    expect(p.onSeekBy).toHaveBeenNthCalledWith(2, 10);
    expect(p.onNext).toHaveBeenCalledOnce();
  });

  it("offers pause while playing", () => {
    render(<MusicBar {...props({ queue: state([A], 0), playing: true })} />);
    expect(screen.getByRole("button", { name: "Pause music" })).toBeTruthy();
  });

  it("shows the playing song's title and who added it", () => {
    render(<MusicBar {...props({ queue: state([A, B], 1, "them") })} />);
    expect(screen.getByText("Song 2")).toBeTruthy();
    expect(screen.getByText("added by K")).toBeTruthy();
  });

  it("changes the volume here only", () => {
    const onVolume = vi.fn();
    render(<MusicBar {...props({ queue: state([A], 0), onVolume })} />);
    fireEvent.change(screen.getByLabelText("Volume"), {
      target: { value: "30" },
    });
    expect(onVolume).toHaveBeenCalledWith(30);
  });
});

describe("Up next", () => {
  function openUpNext(p: MusicBarProps) {
    render(<MusicBar {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /Up next/ }));
    return screen.getByRole("list", { name: "Up next" });
  }

  it("lists every song and lights the one playing", () => {
    const list = openUpNext(props({ queue: state([A, B, C], 1) }));
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    const current = within(list).getByRole("button", { current: true });
    expect(current.textContent).toContain("Song 2");
    expect(current.className).toContain("text-[var(--lamp)]");
    expect(
      within(rows[0]).getByRole("button", { name: /^Song 1/ }).className,
    ).not.toContain("text-[var(--lamp)]");
  });

  it("counts the songs still to come", () => {
    render(<MusicBar {...props({ queue: state([A, B, C], 0) })} />);
    expect(
      screen.getByRole("button", { name: /Up next/ }).textContent,
    ).toContain("2");
  });

  it("jumps to a song and removes one", () => {
    const p = props({ queue: state([A, B, C], 0) });
    const list = openUpNext(p);
    fireEvent.click(within(list).getByRole("button", { name: /^Song 3/ }));
    fireEvent.click(
      within(list).getByRole("button", { name: "Remove Song 2" }),
    );
    expect(p.onJump).toHaveBeenCalledWith(2);
    expect(p.onRemove).toHaveBeenCalledWith(1);
  });
});

describe("the layout", () => {
  it("answers to its own width, so a phone gets two rows and no sideways scroll", () => {
    render(<MusicBar {...props({ queue: state([A], 0) })} />);
    const bar = screen.getByRole("region", { name: "Music" });
    expect(bar.className).toContain("@container");
    expect(bar.innerHTML).toContain("@min-[40rem]:flex-nowrap");
    expect(bar.innerHTML).not.toContain("overflow-x");
  });

  it("keeps clicks off the player, which is only the artwork", () => {
    render(<MusicBar {...props({ queue: state([A], 0) })} />);
    const frame = screen.getByTestId("youtube-player").parentElement!;
    expect(frame.className).toContain("pointer-events-none");
    expect(frame.className).toContain("w-16");
  });

  it("fills the lamp line from the song's position, without re-rendering", async () => {
    render(
      <MusicBar
        {...props({
          queue: state([A], 0),
          positionSec: () => 60,
          durationSec: 240,
        })}
      />,
    );
    const line = screen
      .getByRole("region", { name: "Music" })
      .querySelector<HTMLElement>(".bg-\\[var\\(--lamp\\)\\]")!;
    await waitFor(() => expect(line.style.transform).toBe("scaleX(0.25)"));
    await waitFor(() => expect(screen.getByText("1:00 / 4:00")).toBeTruthy());
  });
});
