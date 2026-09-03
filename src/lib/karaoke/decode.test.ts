import { describe, it, expect } from "vitest";
import { decodeTrack, MAX_TRACK_MB, trackSizeMb, type DecodeTarget } from "./decode";

function fakeBlob(size: number, data: ArrayBuffer = new ArrayBuffer(1)): Blob {
  return {
    size,
    arrayBuffer: async () => data,
  } as unknown as Blob;
}

function fakeTarget(result: AudioBuffer | Promise<never>): DecodeTarget {
  return {
    decodeAudioData: async () => result,
  };
}

function fakeBuffer(duration: number, numberOfChannels: number): AudioBuffer {
  return { duration, numberOfChannels } as unknown as AudioBuffer;
}

describe("decodeTrack", () => {
  it("reports sizes in megabytes and keeps the memory limit explicit", () => {
    expect(MAX_TRACK_MB).toBe(60);
    expect(trackSizeMb(fakeBlob(1.5 * 1024 * 1024))).toBe(1.5);
  });

  it("rejects an empty file before decoding", async () => {
    let decoded = false;
    const target: DecodeTarget = {
      decodeAudioData: async () => {
        decoded = true;
        return fakeBuffer(1, 2);
      },
    };

    expect(await decodeTrack(fakeBlob(0), target)).toEqual({ ok: false, reason: "empty" });
    expect(decoded).toBe(false);
  });

  it("rejects files over the memory limit", async () => {
    const target: DecodeTarget = fakeTarget(fakeBuffer(1, 2));
    expect(await decodeTrack(fakeBlob((MAX_TRACK_MB * 1024 * 1024) + 1), target)).toEqual({
      ok: false,
      reason: "too-big",
    });
  });

  it("reports files that cannot be read", async () => {
    const target: DecodeTarget = fakeTarget(fakeBuffer(1, 2));
    const missingReader = { size: 1 } as unknown as Blob;
    const rejectedReader = fakeBlob(1);
    rejectedReader.arrayBuffer = async () => Promise.reject(new Error("read failed"));

    await expect(decodeTrack(missingReader, target)).resolves.toEqual({
      ok: false,
      reason: "unreadable",
    });
    await expect(decodeTrack(rejectedReader, target)).resolves.toEqual({
      ok: false,
      reason: "unreadable",
    });
  });

  it("reports data the decoder cannot recognize", async () => {
    const target: DecodeTarget = {
      decodeAudioData: async () => Promise.reject(new Error("unsupported format")),
    };

    expect(await decodeTrack(fakeBlob(1), target)).toEqual({ ok: false, reason: "not-audio" });
  });

  it("reports decoded audio with no duration or channels", async () => {
    const target = fakeTarget(fakeBuffer(0, 2));
    const noChannels = fakeTarget(fakeBuffer(1, 0));

    expect(await decodeTrack(fakeBlob(1), target)).toEqual({ ok: false, reason: "empty" });
    expect(await decodeTrack(fakeBlob(1), noChannels)).toEqual({ ok: false, reason: "empty" });
  });

  it("returns the decoded buffer and its decoded duration", async () => {
    const buffer = fakeBuffer(93.25, 2);

    await expect(decodeTrack(fakeBlob(1), fakeTarget(buffer))).resolves.toEqual({
      ok: true,
      buffer,
      durationSec: 93.25,
    });
  });
});
