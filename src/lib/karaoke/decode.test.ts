import { describe, it, expect, vi } from "vitest";
import {
  MAX_TRACK_MB,
  prepareTrack,
  probeVideoDuration,
  trackSizeMb,
  type DurationProbe,
} from "./decode";

function fakeBlob(size: number): Blob {
  return { size } as unknown as Blob;
}

describe("prepareTrack", () => {
  it("reports sizes in megabytes and keeps the memory limit explicit", () => {
    expect(MAX_TRACK_MB).toBe(60);
    expect(trackSizeMb(fakeBlob(1.5 * 1024 * 1024))).toBe(1.5);
  });

  it("uses a valid duration hint without probing", async () => {
    const probe = vi.fn<DurationProbe>();
    const result = await prepareTrack(new Blob(["video"]), 93.25, probe);

    expect(probe).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, durationSec: 93.25 });
    if (result.ok) {
      expect(result.file).toBeInstanceOf(File);
      expect(result.file.name).toBe("track.mp4");
      expect(result.file.type).toBe("video/mp4");
    }
  });

  it("uses the probe without a duration hint", async () => {
    const probe = vi.fn<DurationProbe>().mockResolvedValue(42);

    await expect(prepareTrack(new Blob(["video"]), null, probe)).resolves.toMatchObject({
      ok: true,
      durationSec: 42,
    });
    expect(probe).toHaveBeenCalledOnce();
  });

  it("rejects an empty file before probing", async () => {
    const probe = vi.fn<DurationProbe>();

    await expect(prepareTrack(fakeBlob(0), null, probe)).resolves.toEqual({ ok: false, reason: "empty" });
    expect(probe).not.toHaveBeenCalled();
  });

  it("rejects files over the memory limit", async () => {
    const probe = vi.fn<DurationProbe>();

    await expect(prepareTrack(fakeBlob((MAX_TRACK_MB * 1024 * 1024) + 1), null, probe)).resolves.toEqual({
      ok: false,
      reason: "too-big",
    });
  });

  it("rejects a missing duration", async () => {
    const probe = vi.fn<DurationProbe>().mockResolvedValue(0);

    await expect(prepareTrack(new Blob(["video"]), null, probe)).resolves.toEqual({
      ok: false,
      reason: "no-duration",
    });
  });
});

describe("probeVideoDuration", () => {
  it("gives up rather than hanging when metadata never arrives", async () => {
    // jsdom never fires loadedmetadata, which is exactly the stuck decoder this
    // guards against: without a timeout the promise never settles and the panel
    // says it is still reading the file forever.
    vi.useFakeTimers();
    try {
      URL.createObjectURL = vi.fn(() => "blob:probe-test");
      URL.revokeObjectURL = vi.fn();

      const pending = probeVideoDuration(new Blob(["bytes"]));
      const settled = expect(pending).rejects.toThrow(/too long/i);
      await vi.advanceTimersByTimeAsync(10_000);
      await settled;
      // The object URL is released on the timeout path too, or a file that
      // failed to load would be retained for the life of the page.
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:probe-test");
    } finally {
      vi.useRealTimers();
    }
  });
});
