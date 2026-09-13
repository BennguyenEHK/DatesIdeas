import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DayFilm, type DayFilmProps } from "./DayFilm";
import { Projector } from "./Projector";
import { filmSchedule, neighbourStart, SLIDE_MS, TITLE_MS } from "@/lib/album/film";
import type { AlbumItem } from "@/lib/album/types";

function item(id: string, kind: AlbumItem["kind"] = "photo"): AlbumItem {
  return {
    id,
    kind,
    contentType: kind === "video" ? "video/mp4" : "image/jpeg",
    bytes: 1,
    happenedAt: "2026-09-12T12:00:00Z",
    createdAt: "2026-09-12T12:00:00Z",
    caption: null,
    loved: false,
    sourceRoom: null,
    url: `https://example.test/${id}`,
    posterUrl: kind === "video" ? `https://example.test/${id}-poster` : null,
  };
}

const ITEMS = [item("first"), item("second")];
let frames: FrameRequestCallback[];

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function opacityOf(id: string): number {
  const wrapper = document.querySelector<HTMLElement>(`[data-memory="${id}"]`);
  return wrapper === null ? Number.NaN : Number(wrapper.style.opacity);
}

function flushFrame() {
  const frame = frames.shift();
  if (frame !== undefined) act(() => frame(0));
}

function renderFilm(overrides: Partial<DayFilmProps> = {}) {
  const callbacks = {
    onPause: vi.fn(),
    onResume: vi.fn(),
    onSeek: vi.fn(),
    onClose: vi.fn(),
  };
  let at = 0;
  const props: DayFilmProps = {
    items: ITEMS,
    title: "Saturday, 12 September 2026",
    subtitle: "The good day",
    closing: null,
    elapsedMs: () => at,
    playing: true,
    ...callbacks,
    ...overrides,
  };
  const view = render(<DayFilm {...props} />);
  return {
    ...callbacks,
    ...overrides,
    setElapsed: (elapsed: number) => {
      at = elapsed;
    },
    view,
  };
}

describe("DayFilm", () => {
  it("shows the title card at the beginning", () => {
    renderFilm();
    expect(screen.getAllByText("Saturday, 12 September 2026")).toHaveLength(2);
    expect(screen.getByText("The good day")).toBeTruthy();
  });

  it("shows the second memory at its scheduled time", () => {
    const film = renderFilm();
    film.setElapsed(TITLE_MS + SLIDE_MS + 100);
    flushFrame();
    expect(screen.getAllByAltText("Memory").at(-1)?.getAttribute("src")).toBe(
      "https://example.test/second",
    );
  });

  it("uses a moving memory's poster and never mounts a video", () => {
    const film = renderFilm({ items: [item("moving", "video")] });
    film.setElapsed(TITLE_MS + 100);
    flushFrame();
    expect(screen.getByAltText("Memory").getAttribute("src")).toBe(
      "https://example.test/moving-poster",
    );
    expect(document.querySelector("video")).toBeNull();
  });

  it("maps Space to pause or resume", () => {
    const playing = renderFilm();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: " " });
    expect(playing.onPause).toHaveBeenCalledOnce();
    playing.view.unmount();

    const paused = renderFilm({ playing: false });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: " " });
    expect(paused.onResume).toHaveBeenCalledOnce();
  });

  it("maps next and Escape to their controlled callbacks", () => {
    const film = renderFilm();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });
    expect(film.onSeek).toHaveBeenCalledWith(
      neighbourStart(filmSchedule(["first", "second"]), 0, 1),
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(film.onClose).toHaveBeenCalledOnce();
  });

  it("holds a memory fully until the next one has faded in over it", () => {
    // Fading each memory to black and then drawing it back under the next one
    // flashed between every photograph.
    const film = renderFilm({ items: [item("first"), item("second"), item("third")] });
    film.setElapsed(TITLE_MS + SLIDE_MS - 50);
    flushFrame();
    expect(opacityOf("first")).toBe(1);

    film.setElapsed(TITLE_MS + SLIDE_MS + 100);
    flushFrame();
    expect(opacityOf("first")).toBe(1);
    expect(opacityOf("second")).toBeGreaterThan(0);
    expect(opacityOf("second")).toBeLessThan(1);
  });

  it("keeps the outgoing memory's own framing while it is faded over", () => {
    const film = renderFilm();
    film.setElapsed(TITLE_MS + SLIDE_MS + 100);
    flushFrame();
    const outgoing = document.querySelector<HTMLImageElement>(
      '[data-memory="first"] img[alt="Memory"]',
    );
    // motionFor(0) at its last frame: scale 1.12, offset -3%, -2%.
    expect(outgoing?.style.transform).toBe("translate(-3%, -2%) scale(1.12)");
  });

  it("fades the last memory out before the closing card", () => {
    const film = renderFilm();
    film.setElapsed(TITLE_MS + 2 * SLIDE_MS - 100);
    flushFrame();
    expect(opacityOf("second")).toBeLessThan(1);
  });

  it("keeps the film's keys from reaching the album underneath", () => {
    const outer = vi.fn();
    document.addEventListener("keydown", outer);
    renderFilm();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });
    expect(outer).not.toHaveBeenCalled();
    document.removeEventListener("keydown", outer);
  });

  it("closes only once when several frames arrive after the film ends", () => {
    const film = renderFilm();
    film.setElapsed(filmSchedule(["first", "second"]).totalMs);
    flushFrame();
    flushFrame();
    expect(film.onClose).toHaveBeenCalledOnce();
  });
});

describe("Projector play-the-day action", () => {
  it("only appears for a multi-memory day with a play handler", () => {
    const onPlayDay = vi.fn();
    const projector = render(
      <Projector
        item={ITEMS[0]}
        timeZone="UTC"
        onLove={vi.fn()}
        onCaption={vi.fn()}
        onDelete={vi.fn()}
        dayCount={2}
      />,
    );
    expect(screen.queryByRole("button", { name: "▶ Play this day" })).toBeNull();

    projector.rerender(
      <Projector
        item={ITEMS[0]}
        timeZone="UTC"
        onLove={vi.fn()}
        onCaption={vi.fn()}
        onDelete={vi.fn()}
        onPlayDay={onPlayDay}
        dayCount={1}
      />,
    );
    expect(screen.queryByRole("button", { name: "▶ Play this day" })).toBeNull();

    projector.rerender(
      <Projector
        item={ITEMS[0]}
        timeZone="UTC"
        onLove={vi.fn()}
        onCaption={vi.fn()}
        onDelete={vi.fn()}
        onPlayDay={onPlayDay}
        dayCount={2}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "▶ Play this day" }));
    expect(onPlayDay).toHaveBeenCalledOnce();
  });
});
