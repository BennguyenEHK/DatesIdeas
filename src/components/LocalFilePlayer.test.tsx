import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { PlayerHandle } from "@/lib/media/player";
import { LocalFilePlayer } from "./LocalFilePlayer";

function setup(file: File | null = new File(["film"], "film.mp4")) {
  let handle: PlayerHandle | null = null;
  const onDuration = vi.fn();
  const onError = vi.fn();
  const onStarted = vi.fn();
  const view = render(
    <LocalFilePlayer
      ref={(value) => {
        handle = value;
      }}
      file={file}
      onDuration={onDuration}
      onError={onError}
      onStarted={onStarted}
    />,
  );
  return { ...view, getHandle: () => handle, onDuration, onError, onStarted };
}

function setReady(video: HTMLVideoElement, readyState: number) {
  Object.defineProperty(video, "readyState", {
    configurable: true,
    value: readyState,
  });
}

describe("LocalFilePlayer", () => {
  const createObjectURL = vi.fn((file: File) => `blob:${file.name}`);
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("is not ready before metadata is available", () => {
    const view = setup();
    const video = view.container.querySelector("video")!;
    setReady(video, 0);
    expect(view.getHandle()!.isReady()).toBe(false);
  });

  it("applies early volume later and clamps it", () => {
    const view = setup();
    const handle = view.getHandle()!;
    const video = view.container.querySelector("video")!;

    handle.setVolume(150);
    expect(video.volume).toBe(1);
    handle.setVolume(-20);
    expect(video.volume).toBe(0);

    const nextFile = new File(["next"], "next.mp4");
    view.rerender(
      <LocalFilePlayer
        ref={(value) => {
          // The callback is intentionally plain state, matching the parent API.
          void value;
        }}
        file={nextFile}
        onDuration={view.onDuration}
        onError={view.onError}
      />,
    );
    expect(video.volume).toBe(0);
  });

  it("ignores the id passed to load and seeks to its start", () => {
    const view = setup();
    const video = view.container.querySelector("video")!;
    setReady(video, 1);
    view.getHandle()!.load("a-youtube-id", 42);
    expect(video.currentTime).toBe(42);
  });

  it("nudges locally and changes rate without changing pitch", () => {
    const view = setup();
    const video = view.container.querySelector("video")!;
    const handle = view.getHandle()!;
    Object.defineProperty(video, "preservesPitch", { configurable: true, writable: true, value: false });

    handle.nudge(42);
    expect(video.currentTime).toBe(42);
    expect(handle.setRate(1.03)).toBe(true);
    expect(video.playbackRate).toBe(1.03);
    expect(video.preservesPitch).toBe(true);
  });

  it("revokes the previous object URL when the file changes", () => {
    const view = setup();
    const nextFile = new File(["next"], "next.mp4");
    view.rerender(
      <LocalFilePlayer
        ref={() => {}}
        file={nextFile}
        onDuration={view.onDuration}
        onError={view.onError}
      />,
    );
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:film.mp4");
  });

  it("reports a decode error with the file name", () => {
    const view = setup();
    fireEvent.error(view.container.querySelector("video")!);
    expect(view.onError).toHaveBeenCalledWith(expect.stringContaining("film.mp4"));
    expect(view.onError).toHaveBeenCalledWith(expect.stringMatching(/cannot decode/i));
  });

  it("reports metadata duration and null after clearing", () => {
    const view = setup();
    const video = view.container.querySelector("video")!;
    Object.defineProperty(video, "duration", { configurable: true, value: 123 });
    fireEvent.loadedMetadata(video);
    expect(view.onDuration).toHaveBeenCalledWith(123);

    act(() => view.rerender(
      <LocalFilePlayer
        ref={() => {}}
        file={null}
        onDuration={view.onDuration}
        onError={view.onError}
      />,
    ));
    expect(view.onDuration).toHaveBeenLastCalledWith(null);
  });
});

describe("reporting when playback really starts", () => {
  const createObjectURL = vi.fn((file: File) => `blob:${file.name}`);
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("THE BUG: says when the picture actually moves, not when play was asked for", () => {
    // The sync layer stamps the shared position at the moment it CALLS play,
    // and an element does not begin then -- it decodes and spins up first, by a
    // different amount on each machine. Nothing else can tell the sync layer
    // that this side opened the song late, so nobody corrected it until the
    // drift timer came round up to two seconds later.
    const view = setup();
    const video = view.container.querySelector("video")!;

    act(() => {
      view.getHandle()!.play();
    });
    expect(view.onStarted).not.toHaveBeenCalled();

    fireEvent.playing(video);
    expect(view.onStarted).toHaveBeenCalledTimes(1);
  });

  it("ignores a second start straight after the first", () => {
    // Correcting moves the position, and a browser may answer that with
    // another playing event -- which would ask for another correction. A real
    // start-up happens once.
    const view = setup();
    const video = view.container.querySelector("video")!;

    fireEvent.playing(video);
    fireEvent.playing(video);
    fireEvent.playing(video);

    expect(view.onStarted).toHaveBeenCalledTimes(1);
  });

  it("reports a genuine restart later in the evening", () => {
    vi.useFakeTimers();
    try {
      const view = setup();
      const video = view.container.querySelector("video")!;
      fireEvent.playing(video);
      vi.advanceTimersByTime(600);
      fireEvent.playing(video);
      expect(view.onStarted).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
