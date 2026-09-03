import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { KaraokePanel } from "./KaraokePanel";

function setup(overrides: Partial<Parameters<typeof KaraokePanel>[0]> = {}) {
  const props = {
    videoId: "dQw4w9WgXcQ",
    playing: true,
    videoError: null,
    audioMode: "headphones" as const,
    audioAuto: false,
    onChooseAudio: vi.fn(),
    noisy: false,
    onNoisy: vi.fn(),
    onLoad: vi.fn(),
    track: {
      ready: false,
      loading: false,
      hasLyrics: false,
      error: null,
      onAudioFile: vi.fn(),
      onLyricsFile: vi.fn(),
    },
    picking: false,
    onPick: vi.fn(),
    onCancelPick: vi.fn(),
    musicVolume: 70,
    onMusicVolume: vi.fn(),
    turn: "them" as const,
    offsetMs: 240,
    manual: false,
    onManual: vi.fn(),
    onOffsetMs: vi.fn(),
    onPlayPause: vi.fn(),
    onResync: vi.fn(),
    ...overrides,
  };
  render(<KaraokePanel {...props} />);
  return props;
}

describe("transport-first karaoke controls", () => {
  it("shows the transport and choose-song action before a song is loaded", () => {
    setup({ videoId: null, playing: false });
    expect(screen.getByRole("button", { name: /choose song/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /play the song/i })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: /resync/i })).toHaveProperty("disabled", true);
  });

  it("shows the picker only while picking, and always offers a way out of it", () => {
    // The escape hatch used to be withheld whenever there was no song to go
    // back to, which is exactly when someone is most likely to want it.
    setup({ picking: true, videoId: null });
    expect(screen.getByPlaceholderText(/paste a youtube link/i)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /close without choosing a song/i }),
    ).toBeTruthy();
  });

  it("says what closing the picker will leave you on", () => {
    setup({ picking: true, videoId: "abc" });
    expect(
      screen.getByRole("button", { name: /close and keep the current song/i }),
    ).toBeTruthy();
  });

  it("closes the picker without submitting", () => {
    const p = setup({ picking: true });
    fireEvent.change(screen.getByPlaceholderText(/paste a youtube link/i), {
      target: { value: "not a link yet" },
    });
    fireEvent.click(screen.getByRole("button", { name: /close and keep the current song/i }));
    expect(p.onCancelPick).toHaveBeenCalled();
    expect(p.onLoad).not.toHaveBeenCalled();
  });

  it("enables the delay slider only after the manual checkbox is ticked", () => {
    const p = setup({ manual: false, offsetMs: 240 });
    expect(screen.getByLabelText(/how far to delay/i)).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("checkbox", { name: /set the delay myself/i }));
    expect(p.onManual).toHaveBeenCalledWith(true);
  });

  it("reports a video error in the transport", () => {
    setup({ videoError: 150 });
    expect(screen.getByRole("alert").textContent).toMatch(/outside youtube/i);
  });
});

describe("choosing a track you own", () => {
  function openOwnTrack(overrides = {}) {
    const p = setup({ picking: true, ...overrides });
    fireEvent.click(screen.getByRole("tab", { name: /a track you own/i }));
    return p;
  }

  it("offers the YouTube link first, since that is the familiar way in", () => {
    setup({ picking: true });
    expect(screen.getByPlaceholderText(/paste a youtube link/i)).toBeTruthy();
    expect(screen.getByRole("tab", { name: /youtube link/i })).toHaveProperty(
      "ariaSelected",
      "true",
    );
  });

  it("swaps the link box for file pickers on the own-track tab", () => {
    openOwnTrack();
    expect(screen.queryByPlaceholderText(/paste a youtube link/i)).toBeNull();
    expect(screen.getByLabelText(/choose the audio/i)).toBeTruthy();
  });

  it("says plainly that the file stays put and what is bought by that", () => {
    // The trade is the whole reason this tab exists, so it is stated where the
    // choice is made rather than discovered afterwards.
    openOwnTrack();
    expect(screen.getByText(/stays on this computer/i)).toBeTruthy();
    expect(screen.getByText(/a youtube video cannot do/i)).toBeTruthy();
  });

  it("hands an audio file straight to the room", () => {
    const p = openOwnTrack();
    const file = new File(["bytes"], "song.mp3", { type: "audio/mpeg" });
    fireEvent.change(screen.getByLabelText(/choose the audio/i), {
      target: { files: [file] },
    });
    expect(p.track.onAudioFile).toHaveBeenCalledWith(file);
  });

  it("keeps lyrics optional and marked as such", () => {
    openOwnTrack();
    expect(screen.getByLabelText(/add lyrics .*optional/i)).toBeTruthy();
  });

  it("shows a decode failure instead of the explanation", () => {
    openOwnTrack({
      track: {
        ready: false,
        loading: false,
        hasLyrics: false,
        error: "This browser cannot decode that file.",
        onAudioFile: vi.fn(),
        onLyricsFile: vi.fn(),
      },
    });
    expect(screen.getByRole("alert").textContent).toMatch(/cannot decode/i);
    expect(screen.queryByText(/stays on this computer/i)).toBeNull();
  });

  it("can still be closed from the own-track tab", () => {
    const p = openOwnTrack();
    fireEvent.click(
      screen.getByRole("button", { name: /close and keep the current song/i }),
    );
    expect(p.onCancelPick).toHaveBeenCalled();
  });
});
