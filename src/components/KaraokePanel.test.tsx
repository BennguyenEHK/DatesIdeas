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
      error: null,
      onMediaFile: vi.fn(),
    },
    helper: {
      available: false as boolean | null,
      busy: false,
      note: null as string | null,
      percent: null as number | null,
      error: null as string | null,
      onFetchUrl: vi.fn(),
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
    landing: null as "here" | "there" | null,
    landingPercent: null as number | null,
    ...overrides,
  };
  render(<KaraokePanel {...props} />);
  return props;
}

describe("transport-first karaoke controls", () => {
  it("warns that speakers send the other person's room back through the mic", () => {
    setup({ audioMode: "speakers" });
    expect(screen.getByRole("note").textContent).toMatch(
      /sends their voice and room back to them .* keep the volume down, or use headphones/i,
    );
  });

  it("does not show the speaker warning with headphones", () => {
    setup({ audioMode: "headphones" });
    expect(screen.queryByRole("note")).toBeNull();
  });

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

describe("pasting a link when a helper can fetch it", () => {
  const HELPER = {
    available: true,
    busy: false,
    note: null,
    percent: null,
    error: null,
    onFetchUrl: vi.fn(),
  };

  function paste(props = {}) {
    const p = setup({ picking: true, helper: { ...HELPER, onFetchUrl: vi.fn() }, ...props });
    fireEvent.change(screen.getByPlaceholderText(/paste a youtube link/i), {
      target: { value: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    });
    return p;
  }

  it("fetches through the helper instead of embedding the video", () => {
    // The whole point of the helper: the same link becomes audio both sides
    // can nudge faster, rather than a video that cannot change speed at all.
    const p = paste();
    fireEvent.click(screen.getByRole("button", { name: /load song/i }));
    expect(p.helper.onFetchUrl).toHaveBeenCalledWith(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
    expect(p.onLoad).not.toHaveBeenCalled();
  });

  it("embeds the video when no helper answered", () => {
    const p = setup({ picking: true, helper: { ...HELPER, available: false, onFetchUrl: vi.fn() } });
    fireEvent.change(screen.getByPlaceholderText(/paste a youtube link/i), {
      target: { value: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    });
    fireEvent.click(screen.getByRole("button", { name: /load song/i }));
    expect(p.onLoad).toHaveBeenCalledWith("dQw4w9WgXcQ");
    expect(p.helper.onFetchUrl).not.toHaveBeenCalled();
  });

  it("does not fetch a link that is not YouTube", () => {
    const p = setup({ picking: true, helper: { ...HELPER, onFetchUrl: vi.fn() } });
    fireEvent.change(screen.getByPlaceholderText(/paste a youtube link/i), {
      target: { value: "https://vimeo.com/12345" },
    });
    fireEvent.click(screen.getByRole("button", { name: /load song/i }));
    expect(p.helper.onFetchUrl).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/doesn.t look like a youtube link/i);
  });

  it("refuses a second submit while one is already running", () => {
    // Fetching takes the better part of a minute, which is exactly long
    // enough for someone to press the button again.
    const p = paste({ helper: { ...HELPER, busy: true, onFetchUrl: vi.fn() } });
    const button = screen.getByRole("button", { name: /working/i });
    expect(button).toHaveProperty("disabled", true);
    fireEvent.click(button);
    expect(p.helper.onFetchUrl).not.toHaveBeenCalled();
  });

  it("says what is happening during the wait", () => {
    setup({
      picking: true,
      helper: { ...HELPER, busy: true, note: "Receiving the song — 40%" },
    });
    expect(screen.getByText(/receiving the song — 40%/i)).toBeTruthy();
  });

  it("shows a helper failure in place of the hint", () => {
    setup({
      picking: true,
      helper: { ...HELPER, error: "The helper on your computer did not answer." },
    });
    expect(screen.getByRole("alert").textContent).toMatch(/did not answer/i);
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

  it("swaps the link box for a file picker on the own-track tab", () => {
    openOwnTrack();
    expect(screen.queryByPlaceholderText(/paste a youtube link/i)).toBeNull();
    expect(screen.getByLabelText(/choose the video/i)).toBeTruthy();
  });

  it("says plainly that the file stays put and what is bought by that", () => {
    // The trade is the whole reason this tab exists, so it is stated where the
    // choice is made rather than discovered afterwards.
    openOwnTrack();
    expect(screen.getByText(/stays on this computer/i)).toBeTruthy();
    expect(screen.getByText(/a youtube video cannot do/i)).toBeTruthy();
  });

  it("hands a video file straight to the room", () => {
    const p = openOwnTrack();
    const file = new File(["bytes"], "song.mp4", { type: "video/mp4" });
    fireEvent.change(screen.getByLabelText(/choose the video/i), {
      target: { files: [file] },
    });
    expect(p.track.onMediaFile).toHaveBeenCalledWith(file);
  });

  it("no longer asks for a lyrics file, because the picture carries the words", () => {
    openOwnTrack();
    expect(screen.queryByLabelText(/lyrics/i)).toBeNull();
  });

  it("shows a failure instead of the explanation", () => {
    openOwnTrack({
      track: {
        ready: false,
        loading: false,
        error: "This browser cannot decode that file.",
        onMediaFile: vi.fn(),
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

describe("the wait, and how honestly it is drawn", () => {
  const waiting = (note: string, percent: number | null) => ({
    available: true,
    busy: true,
    note,
    percent,
    error: null,
    onFetchUrl: vi.fn(),
  });

  it("shows no progress bar at all when nothing is being fetched", () => {
    setup({ picking: true });
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("reports a real figure once the share is known", () => {
    setup({
      picking: true,
      helper: waiting("The song is arriving from their computer — 60%", 60),
    });
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("60");
  });

  it("THE RULE: an unknown share is indeterminate, never zero", () => {
    // The helper's own download reports no total, and drawing that as 0% would
    // read as a stall for the twenty-odd seconds it takes -- which is exactly
    // the impression that made this feature look broken before. Omitting
    // aria-valuenow is how the platform spells "indeterminate".
    setup({
      picking: true,
      helper: waiting("The helper is downloading the video — this takes about half a minute.", null),
    });
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBeNull();
  });

  it("says which of the two waits is happening", () => {
    setup({
      picking: true,
      helper: waiting("The helper is downloading the video — this takes about half a minute.", null),
    });
    expect(screen.getByText(/downloading the video/i)).toBeTruthy();
  });

  it("keeps the wait visible from the transport, not only the picker", () => {
    // A fetch outlives the picker that started it. If the bar lived only in the
    // picker, closing it would leave the panel silent mid-download.
    setup({
      picking: false,
      helper: waiting("The song is arriving from their computer — 30%", 30),
    });
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("30");
  });

  it("shows guidance that only one person needs to paste", () => {
    setup({
      picking: true,
      helper: {
        available: true,
        busy: false,
        note: null,
        percent: null,
        error: null,
        onFetchUrl: vi.fn(),
      },
    });
    expect(
      screen.getByText(
        /only one of you needs to paste the link, because the song reaches the other person automatically/i,
      ),
    ).toBeTruthy();
  });

  it("does not show the paste guidance when helper is not available", () => {
    setup({
      picking: true,
      helper: {
        available: false,
        busy: false,
        note: null,
        percent: null,
        error: null,
        onFetchUrl: vi.fn(),
      },
    });
    expect(
      screen.queryByText(
        /only one of you needs to paste the link/i,
      ),
    ).toBeNull();
  });
});

describe("a song only one of you is holding", () => {
  it("THE BUG: will not let anyone drive a song the other side has not got", () => {
    // Reported from a real call. She loaded a new song; it played on her side
    // while his browser was still receiving the bytes and still showing the
    // PREVIOUS song. One shared play button then started two different songs.
    setup({ landing: "there", playing: false });
    expect(screen.getByRole("button", { name: /waiting for the song/i })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: /resync/i })).toHaveProperty("disabled", true);
  });

  it("is equally locked on the side that is still receiving", () => {
    setup({ landing: "here", playing: false });
    expect(screen.getByRole("button", { name: /waiting for the song/i })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("says which computer is being waited on, since only one of them can act", () => {
    setup({ landing: "there" });
    expect(screen.getByText(/loading song on their computer/i)).toBeTruthy();
  });

  it("shows how far the song has got when that is known", () => {
    setup({ landing: "here", landingPercent: 42 });
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("42");
  });

  it("frees the transport again once both sides hold it", () => {
    setup({ landing: null, playing: false });
    expect(screen.getByRole("button", { name: /play the song/i })).toHaveProperty(
      "disabled",
      false,
    );
  });
});
