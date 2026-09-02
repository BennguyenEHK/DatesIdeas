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
