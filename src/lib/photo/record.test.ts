import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLIP_FPS,
  CLIP_MIME_TYPES,
  clipSizeMb,
  phoneCanKeep,
  pickMimeType,
  startRecording,
  type RecordableCanvas,
} from "./record";

type TrackFake = MediaStreamTrack & { stop: ReturnType<typeof vi.fn> };
type StreamFake = MediaStream & { getTracks: ReturnType<typeof vi.fn> };

class FakeMediaRecorder {
  static supported = new Set<string>(["video/webm"]);
  static throwOnConstruct = false;
  static isTypeSupported(type: string): boolean {
    return FakeMediaRecorder.supported.has(type);
  }

  state = "recording";
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;
  readonly start = vi.fn();
  readonly stop = vi.fn(() => {
    this.state = "inactive";
    this.onstop?.();
  });

  constructor(
    readonly stream: MediaStream,
    readonly options: MediaRecorderOptions,
  ) {
    if (FakeMediaRecorder.throwOnConstruct) throw new Error("unsupported");
  }

  emit(data: Blob): void {
    this.ondataavailable?.({ data } as BlobEvent);
  }
}

const originalRecorder = Object.getOwnPropertyDescriptor(globalThis, "MediaRecorder");
let latestRecorder: FakeMediaRecorder | null = null;

/** Takes the instance as an argument rather than aliasing `this` to a local. */
function remember(recorder: FakeMediaRecorder): void {
  latestRecorder = recorder;
}

function installRecorder(): void {
  FakeMediaRecorder.supported = new Set(["video/webm"]);
  FakeMediaRecorder.throwOnConstruct = false;
  latestRecorder = null;
  class InstalledRecorder extends FakeMediaRecorder {
    constructor(stream: MediaStream, options: MediaRecorderOptions) {
      super(stream, options);
      remember(this);
    }
  }
  Object.defineProperty(globalThis, "MediaRecorder", {
    configurable: true,
    value: InstalledRecorder,
  });
}

function makeStream(): { stream: StreamFake; tracks: TrackFake[] } {
  const tracks = [
    { stop: vi.fn() } as unknown as TrackFake,
    { stop: vi.fn() } as unknown as TrackFake,
  ];
  const stream = { getTracks: vi.fn(() => tracks) } as unknown as StreamFake;
  return { stream, tracks };
}

function makeCanvas(stream: MediaStream): RecordableCanvas & { captureStream: ReturnType<typeof vi.fn> } {
  return { captureStream: vi.fn(() => stream) };
}

function recorder(): FakeMediaRecorder {
  if (latestRecorder === null) throw new Error("expected a recorder");
  return latestRecorder;
}

afterEach(() => {
  if (originalRecorder === undefined) {
    Reflect.deleteProperty(globalThis, "MediaRecorder");
  } else {
    Object.defineProperty(globalThis, "MediaRecorder", originalRecorder);
  }
  vi.restoreAllMocks();
});

describe("pickMimeType", () => {
  it("keeps every MP4 candidate before every WebM candidate", () => {
    const mp4Indexes = CLIP_MIME_TYPES
      .map((type, index) => type.toLowerCase().startsWith("video/mp4") ? index : -1)
      .filter((index) => index >= 0);
    const webmIndexes = CLIP_MIME_TYPES
      .map((type, index) => type.toLowerCase().startsWith("video/webm") ? index : -1)
      .filter((index) => index >= 0);

    expect(Math.max(...mp4Indexes)).toBeLessThan(Math.min(...webmIndexes));
  });

  /**
   * MP4 leads deliberately. A live photo is made to be scanned onto a phone,
   * and an iPhone cannot save WebM to Photos at all -- so the format is chosen
   * for where the file ends up, not for where it is recorded.
   */
  it("prefers MP4, because that is what a phone will keep", () => {
    const support = { isTypeSupported: vi.fn(() => true) };
    expect(pickMimeType(support)).toBe("video/mp4;codecs=avc1.42E01E");
    expect(CLIP_MIME_TYPES[0]).toContain("mp4");
  });

  it("falls back through the candidates in order", () => {
    const unsupported = new Set([
      "video/mp4;codecs=avc1.42E01E",
      "video/mp4",
      "video/webm;codecs=vp9",
    ]);
    const support = { isTypeSupported: vi.fn((type: string) => !unsupported.has(type)) };

    expect(pickMimeType(support)).toBe("video/webm;codecs=vp8");
    expect(CLIP_MIME_TYPES).toEqual([
      "video/mp4;codecs=avc1.42E01E",
      "video/mp4",
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ]);
  });

  it("still records WebM where MP4 is unavailable", () => {
    const support = { isTypeSupported: vi.fn((type: string) => type.startsWith("video/webm")) };
    expect(pickMimeType(support)).toBe("video/webm;codecs=vp9");
  });

  it("returns null when no type is supported", () => {
    expect(pickMimeType({ isTypeSupported: () => false })).toBeNull();
  });

  it("returns null without a global recorder", () => {
    Reflect.deleteProperty(globalThis, "MediaRecorder");
    expect(pickMimeType()).toBeNull();
  });
});

describe("phoneCanKeep", () => {
  it.each([
    ["video/mp4;codecs=avc1.42E01E", true],
    ["video/mp4", true],
    ["VIDEO/MP4", true],
    ["video/webm;codecs=vp9", false],
    ["video/webm", false],
    [null, false],
    [undefined, false],
    ["", false],
    ["audio/mp4", false],
  ])("returns %s -> %s", (mimeType, expected) => {
    expect(phoneCanKeep(mimeType)).toBe(expected);
  });
});

describe("startRecording", () => {
  it("returns null for a null canvas", () => {
    installRecorder();
    expect(startRecording(null)).toBeNull();
  });

  it("returns null without a global recorder", () => {
    Reflect.deleteProperty(globalThis, "MediaRecorder");
    const { stream } = makeStream();
    expect(startRecording(makeCanvas(stream))).toBeNull();
  });

  it("returns null when captureStream throws", () => {
    installRecorder();
    const canvas = { captureStream: vi.fn(() => { throw new Error("no stream"); }) };
    expect(startRecording(canvas)).toBeNull();
  });

  it("returns null when construction throws", () => {
    installRecorder();
    FakeMediaRecorder.throwOnConstruct = true;
    const { stream, tracks } = makeStream();

    expect(startRecording(makeCanvas(stream))).toBeNull();
    for (const track of tracks) expect(track.stop).toHaveBeenCalledOnce();
  });

  it("returns null without a supported type", () => {
    installRecorder();
    FakeMediaRecorder.supported.clear();
    const { stream } = makeStream();
    expect(startRecording(makeCanvas(stream))).toBeNull();
  });

  it("captures the default frame rate", () => {
    installRecorder();
    const { stream } = makeStream();
    const canvas = makeCanvas(stream);
    startRecording(canvas);
    expect(canvas.captureStream).toHaveBeenCalledWith(CLIP_FPS);
  });

  it("assembles received chunks into a blob", async () => {
    installRecorder();
    const { stream } = makeStream();
    const recording = startRecording(makeCanvas(stream));
    expect(recording).not.toBeNull();
    recorder().emit(new Blob(["live"]));

    const clip = await recording?.stop();
    expect(await clip?.blob.text()).toBe("live");
    expect(clip?.mimeType).toBe("video/webm");
  });

  it("skips zero-size chunks", async () => {
    installRecorder();
    const { stream } = makeStream();
    const recording = startRecording(makeCanvas(stream));
    expect(recording).not.toBeNull();
    recorder().emit(new Blob());

    await expect(recording?.stop()).resolves.toBeNull();
  });

  it("resolves null when no chunks arrive", async () => {
    installRecorder();
    const { stream } = makeStream();
    const recording = startRecording(makeCanvas(stream));
    await expect(recording?.stop()).resolves.toBeNull();
  });

  it("returns one promise when stopped twice", async () => {
    installRecorder();
    const { stream } = makeStream();
    const recording = startRecording(makeCanvas(stream));
    expect(recording).not.toBeNull();
    const first = recording?.stop();
    const second = recording?.stop();

    expect(first).toBe(second);
    await first;
    expect(recorder().stop).toHaveBeenCalledOnce();
  });

  it("resolves null when stopped after cancellation", async () => {
    installRecorder();
    const { stream } = makeStream();
    const recording = startRecording(makeCanvas(stream));
    recording?.cancel();
    await expect(recording?.stop()).resolves.toBeNull();
  });

  it("makes cancelling twice a no-op", () => {
    installRecorder();
    const { stream, tracks } = makeStream();
    const recording = startRecording(makeCanvas(stream));
    recording?.cancel();
    recording?.cancel();

    expect(recorder().stop).toHaveBeenCalledOnce();
    for (const track of tracks) expect(track.stop).toHaveBeenCalledOnce();
  });

  it("stops tracks after a finished recording", async () => {
    installRecorder();
    const { stream, tracks } = makeStream();
    const recording = startRecording(makeCanvas(stream));
    recorder().emit(new Blob(["frame"]));
    await recording?.stop();

    for (const track of tracks) expect(track.stop).toHaveBeenCalledOnce();
  });

  it("measures duration with the injected clock", async () => {
    installRecorder();
    const now = vi.fn().mockReturnValueOnce(100.2).mockReturnValueOnce(456.8);
    const { stream } = makeStream();
    const recording = startRecording(makeCanvas(stream), { now });
    recorder().emit(new Blob(["frame"]));

    await expect(recording?.stop()).resolves.toMatchObject({ durationMs: 357 });
  });

  it("settles from chunks when the recorder is already inactive", async () => {
    installRecorder();
    const { stream } = makeStream();
    const recording = startRecording(makeCanvas(stream));
    recorder().emit(new Blob(["frame"]));
    recorder().state = "inactive";

    await expect(recording?.stop()).resolves.toMatchObject({ mimeType: "video/webm" });
  });
});

describe("clipSizeMb", () => {
  it("returns zero for no clip", () => {
    expect(clipSizeMb(null)).toBe(0);
  });

  it("rounds a clip size to one decimal place", () => {
    const bytes = Math.round(1.26 * 1024 * 1024);
    expect(clipSizeMb({ blob: new Blob([new Uint8Array(bytes)]), mimeType: "video/webm", durationMs: 0 })).toBe(1.3);
  });
});
