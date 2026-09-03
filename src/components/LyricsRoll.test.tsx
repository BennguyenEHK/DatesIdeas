import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { LyricsRoll } from "./LyricsRoll";
import type { LrcLine } from "@/lib/karaoke/lrc";

const LINES: LrcLine[] = [
  { atSec: 2, text: "First line" },
  { atSec: 5, text: "Second line" },
  { atSec: 8, text: "Third line" },
  { atSec: 11, text: "Fourth line" },
];

let frames: FrameRequestCallback[];
let frameIds: number[];
let position: number;

function stubAnimationFrames() {
  frames = [];
  frameIds = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    const id = frameIds.length + 1;
    frameIds.push(id);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
}

function renderLyrics(paused = false) {
  return render(
    <LyricsRoll lines={LINES} positionSec={() => position} paused={paused} />,
  );
}

function driveFrame() {
  const frame = frames.shift();
  if (frame === undefined) throw new Error("Expected a queued animation frame");
  act(() => frame(16));
}

beforeEach(() => {
  position = 0;
  stubAnimationFrames();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("LyricsRoll", () => {
  it("shows a quiet helper when there are no lyrics", () => {
    render(<LyricsRoll lines={[]} positionSec={() => 0} paused={false} />);

    expect(screen.getByText(/No lyrics loaded/i)).toBeTruthy();
  });

  it("keeps the first lines dimmed before the first timestamp", () => {
    renderLyrics();
    driveFrame();

    expect(screen.getByText("First line").getAttribute("aria-hidden")).toBe("true");
    // The live region itself is always mounted; before the first timestamp it
    // simply has nothing unhidden inside it to announce.
    const region = document.querySelector('[aria-live="polite"]');
    expect(region).not.toBeNull();
    expect(region?.querySelectorAll("p:not([aria-hidden])")).toHaveLength(0);
  });

  it("lights the line containing the playhead and shows context", () => {
    renderLyrics();
    position = 6;
    driveFrame();

    // The lit line is the one thing NOT hidden inside the live region. The
    // region is the stable container: a live region that appears at the same
    // moment as its content is never announced at all.
    expect(screen.getByText("Second line").getAttribute("aria-hidden")).toBeNull();
    expect(
      document.querySelector('[aria-live="polite"]')?.contains(screen.getByText("Second line")),
    ).toBe(true);
    expect(screen.getByText("First line").getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByText("Third line").getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByText("Fourth line").getAttribute("aria-hidden")).toBe("true");
  });

  it("changes what is lit only when the playhead crosses into a new line", () => {
    // Deliberately asserted through the OUTPUT rather than a render count. A
    // render counter has to live in a parent, and this component's own
    // setState never re-renders its parent -- so that counter would sit still
    // however often this re-rendered, and prove nothing at all.
    const positionReader = vi.fn(() => position);
    const lit = () =>
      document
        .querySelector('[aria-live="polite"]')
        ?.querySelector("p:not([aria-hidden])")?.textContent ?? null;

    render(<LyricsRoll lines={LINES} positionSec={positionReader} paused={false} />);

    position = 3;
    driveFrame();
    expect(lit()).toBe("First line");

    position = 4;
    driveFrame();
    expect(lit()).toBe("First line");

    position = 6;
    driveFrame();
    expect(lit()).toBe("Second line");

    // The loop still read the playhead on every one of those frames; it is the
    // React update that is withheld, not the measurement.
    expect(positionReader).toHaveBeenCalledTimes(3);
  });

  it("stops scheduling and reading when paused becomes true", () => {
    const positionReader = vi.fn(() => position);
    const view = render(
      <LyricsRoll lines={LINES} positionSec={positionReader} paused={false} />,
    );
    driveFrame();
    const cancel = vi.mocked(cancelAnimationFrame);
    view.rerender(<LyricsRoll lines={LINES} positionSec={positionReader} paused />);
    const readsBeforeStrayFrame = positionReader.mock.calls.length;
    const pending = frames.shift();
    act(() => pending?.(32));

    expect(cancel).toHaveBeenCalled();
    expect(positionReader).toHaveBeenCalledTimes(readsBeforeStrayFrame);
  });
});
