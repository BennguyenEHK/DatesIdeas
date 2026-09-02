import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { KaraokePanel } from "./KaraokePanel";

/** A panel mid-song, with everything stubbed unless a test cares. */
function setup(overrides: Partial<Parameters<typeof KaraokePanel>[0]> = {}) {
  const props = {
    videoId: "dQw4w9WgXcQ",
    playing: true,
    videoError: null,
    audioMode: "headphones" as const,
    onChooseAudio: vi.fn(),
    noisy: false,
    onNoisy: vi.fn(),
    onLoad: vi.fn(),
    picking: false,
    onPick: vi.fn(),
    onCancelPick: vi.fn(),
    musicVolume: 70,
    onMusicVolume: vi.fn(),
    matchSinging: false,
    onMatchSinging: vi.fn(),
    offsetMs: 0,
    onOffsetMs: vi.fn(),
    suggestedOffsetMs: 240,
    onPlayPause: vi.fn(),
    onResync: vi.fn(),
    ...overrides,
  };
  render(<KaraokePanel {...props} />);
  return props;
}

const closeButton = () =>
  screen.queryByRole("button", { name: /close and keep the current song/i });

describe("changing song", () => {
  it("opens the picker without stopping the song", () => {
    // It used to call clear(), which is shared state -- so going to look for
    // the next track cut the other person off mid-verse.
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: "Change song" }));
    expect(p.onPick).toHaveBeenCalled();
  });

  it("shows the picker once it has been opened", () => {
    setup({ picking: true });
    expect(screen.getByPlaceholderText(/paste a youtube link/i)).toBeTruthy();
  });

  it("offers a way back out", () => {
    const p = setup({ picking: true });
    fireEvent.click(closeButton()!);
    expect(p.onCancelPick).toHaveBeenCalled();
  });

  it("does not submit the form when backing out", () => {
    // A bare button inside a form submits. Cancelling would then try to load
    // whatever half-typed text was in the box.
    const p = setup({ picking: true });
    fireEvent.change(screen.getByPlaceholderText(/paste a youtube link/i), {
      target: { value: "not a link yet" },
    });
    fireEvent.click(closeButton()!);
    expect(p.onLoad).not.toHaveBeenCalled();
  });

  it("returns to the transport controls after loading", () => {
    const p = setup({ picking: true });
    fireEvent.change(screen.getByPlaceholderText(/paste a youtube link/i), {
      target: { value: "https://youtu.be/dQw4w9WgXcQ" },
    });
    fireEvent.submit(screen.getByPlaceholderText(/paste a youtube link/i).closest("form")!);
    expect(p.onLoad).toHaveBeenCalledWith("dQw4w9WgXcQ");
  });
});

describe("when there is nothing to go back to", () => {
  it("offers no way out before a song is ever chosen", () => {
    // Closing would leave an empty panel with no way to reopen it.
    setup({ videoId: null });
    expect(closeButton()).toBeNull();
  });

  it("offers no way out after a video was refused", () => {
    // The song behind the picker is one that will not play.
    setup({ videoId: "dQw4w9WgXcQ", videoError: 150 });
    expect(closeButton()).toBeNull();
  });

  it("still explains why the video was refused", () => {
    setup({ videoId: "dQw4w9WgXcQ", videoError: 150 });
    expect(screen.getByRole("alert").textContent).toMatch(/outside youtube/i);
  });
});

describe("the noisy room switch", () => {
  it("reports a quiet room by default", () => {
    setup();
    expect(screen.getByRole("button", { name: /quiet room/i })).toBeTruthy();
  });

  it("turns a noisy room on", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: /quiet room/i }));
    expect(p.onNoisy).toHaveBeenCalledWith(true);
  });

  it("turns it back off", () => {
    const p = setup({ noisy: true });
    fireEvent.click(screen.getByRole("button", { name: /noisy room/i }));
    expect(p.onNoisy).toHaveBeenCalledWith(false);
  });
});

describe("matching their singing", () => {
  const toggle = () => screen.getByRole("button", { name: /match their singing/i });

  it("is off until asked for", () => {
    setup();
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByLabelText(/how far to delay/i)).toBeNull();
  });

  it("turns on", () => {
    const p = setup();
    fireEvent.click(toggle());
    expect(p.onMatchSinging).toHaveBeenCalledWith(true);
  });

  it("shows the amount only once it is doing something", () => {
    setup({ matchSinging: true, offsetMs: 240 });
    expect(screen.getByLabelText(/how far to delay/i)).toBeTruthy();
    expect(screen.getByText("240ms")).toBeTruthy();
  });

  it("says out loud that it only works one way at a time", () => {
    // The whole reason it is a switch and not a setting. Someone who leaves it
    // on will sound twice as late to the other person and never know why.
    setup({ matchSinging: true, offsetMs: 240 });
    expect(document.body.textContent).toMatch(/your turn to sing/i);
  });

  it("offers the measured delay rather than making you guess", () => {
    setup({ suggestedOffsetMs: 240 });
    expect(toggle().getAttribute("title")).toMatch(/240ms/);
  });
});

describe("the audio gate", () => {
  it("comes before everything else", () => {
    // A synced song into an open mic is one round trip from an echo.
    setup({ audioMode: null, videoId: null });
    expect(screen.getByRole("button", { name: /headphones/i })).toBeTruthy();
    expect(screen.queryByPlaceholderText(/paste a youtube link/i)).toBeNull();
  });
});
