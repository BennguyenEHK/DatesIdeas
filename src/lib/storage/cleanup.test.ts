import { describe, expect, it, vi } from "vitest";
import { ORPHAN_GRACE_MS, keepsakeRoom, runCleanup, type CleanupDeps } from "./cleanup";

const NOW = new Date("2026-09-13T09:00:00.000Z");
const old = new Date(NOW.getTime() - ORPHAN_GRACE_MS - 60_000);
const fresh = new Date(NOW.getTime() - 60_000);

function deps(overrides: Partial<CleanupDeps> & { bucket?: Record<string, Date | null> } = {}) {
  const bucket = overrides.bucket ?? {};
  const deleted: string[] = [];
  const base: CleanupDeps = {
    now: NOW,
    listKeys: async (prefix) =>
      Object.entries(bucket)
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, lastModified]) => ({ key, lastModified })),
    deleteKeys: async (keys) => {
      deleted.push(...keys);
      return keys.length;
    },
    openRoomCodes: async () => new Set<string>(),
    deleteClosedKeepsakeRows: async () => 0,
    albumKeysInUse: async () => new Set<string>(),
    albumItemCount: async () => 0,
  };
  return { deps: { ...base, ...overrides }, deleted };
}

describe("keepsakeRoom", () => {
  it("reads the room from a file filed by date", () => {
    expect(keepsakeRoom("keepsakes/2026/09/12_21-04-17_strip_KW3KDD_8e2d4a1b.png")).toBe("KW3KDD");
  });

  it("reads the room from a folder saved before files were filed by date", () => {
    expect(keepsakeRoom("keepsakes/KW3KDD/strip-a.png")).toBe("KW3KDD");
  });

  it("places nothing it does not recognise, so nothing unknown is deleted", () => {
    for (const key of ["keepsakes/2026/09/notes.txt", "keepsakes/2026/x.png", "album/2026/09/a.jpg", "keepsakes/"]) {
      expect(keepsakeRoom(key)).toBeNull();
    }
  });
});

describe("closed rooms' photo booth files", () => {
  it("deletes every file from a closed room, across month folders", async () => {
    // A room open over midnight on the last of the month leaves strips in two
    // month folders. Both belong to it and both go.
    const { deps: d, deleted } = deps({
      bucket: {
        "keepsakes/2026/08/31_23-50-00_strip_KW3KDD_aaaaaaaa.png": old,
        "keepsakes/2026/09/01_00-10-00_clip_KW3KDD_bbbbbbbb.mp4": old,
        "keepsakes/KW3KDD/strip-legacy.png": old,
      },
    });
    const report = await runCleanup(d);
    expect(deleted.sort()).toEqual([
      "keepsakes/2026/08/31_23-50-00_strip_KW3KDD_aaaaaaaa.png",
      "keepsakes/2026/09/01_00-10-00_clip_KW3KDD_bbbbbbbb.mp4",
      "keepsakes/KW3KDD/strip-legacy.png",
    ]);
    expect(report.closedRooms).toEqual(["KW3KDD"]);
    expect(report.keepsakeFilesDeleted).toBe(3);
  });

  it("leaves a room that is still open alone, however old its files are", async () => {
    // Its QR links still work tonight. Deleting them would break a link
    // somebody may be about to scan.
    const { deps: d, deleted } = deps({
      bucket: {
        "keepsakes/2026/09/12_20-00-00_strip_OPEN12_aaaaaaaa.png": old,
        "keepsakes/2026/09/12_20-00-00_strip_SHUT34_bbbbbbbb.png": fresh,
      },
      openRoomCodes: async () => new Set(["OPEN12"]),
    });
    const report = await runCleanup(d);
    expect(deleted).toEqual(["keepsakes/2026/09/12_20-00-00_strip_SHUT34_bbbbbbbb.png"]);
    expect(report.closedRooms).toEqual(["SHUT34"]);
  });

  it("never deletes a file it cannot place in a room", async () => {
    const { deps: d, deleted } = deps({ bucket: { "keepsakes/2026/09/mystery.png": old } });
    await runCleanup(d);
    expect(deleted).toEqual([]);
  });

  it("does not ask which rooms are open when there are no booth files at all", async () => {
    const openRoomCodes = vi.fn(async () => new Set<string>());
    const { deps: d } = deps({ openRoomCodes });
    await runCleanup(d);
    expect(openRoomCodes).not.toHaveBeenCalled();
  });

  it("never deletes an album file because a room closed", async () => {
    // A recording shared by QR has a share record pointing into the album. The
    // room closing takes the record, never the recording.
    const { deps: d, deleted } = deps({
      bucket: { "album/pair-1/recording-a.webm": old },
      albumKeysInUse: async () => new Set(["album/pair-1/recording-a.webm"]),
      albumItemCount: async () => 1,
      deleteClosedKeepsakeRows: async () => 3,
    });
    const report = await runCleanup(d);
    expect(deleted).toEqual([]);
    expect(report.keepsakeRowsDeleted).toBe(3);
  });
});

describe("album files no entry uses", () => {
  it("deletes one that has been stuck for more than a day", async () => {
    const { deps: d, deleted } = deps({
      bucket: {
        "album/pair-1/photo-stuck.jpg": old,
        "album/2026/09/12_18-02-41_photo_3f9a0c1e.jpg": old,
      },
    });
    const report = await runCleanup(d);
    expect(deleted.sort()).toEqual(["album/2026/09/12_18-02-41_photo_3f9a0c1e.jpg", "album/pair-1/photo-stuck.jpg"]);
    expect(report.albumOrphansDeleted).toBe(2);
  });

  it("spares one less than a day old, which may be an upload still in progress", async () => {
    const { deps: d, deleted } = deps({ bucket: { "album/pair-1/photo-uploading.jpg": fresh } });
    await runCleanup(d);
    expect(deleted).toEqual([]);
  });

  it("spares one whose age the bucket did not report", async () => {
    const { deps: d, deleted } = deps({ bucket: { "album/pair-1/photo-unknown.jpg": null } });
    await runCleanup(d);
    expect(deleted).toEqual([]);
  });

  it("keeps every file an album entry uses, including a video's still", async () => {
    const { deps: d, deleted } = deps({
      bucket: {
        "album/pair-1/video-a.mp4": old,
        "album/pair-1/video-a-poster.jpg": old,
      },
      albumKeysInUse: async () => new Set(["album/pair-1/video-a.mp4", "album/pair-1/video-a-poster.jpg"]),
      albumItemCount: async () => 1,
    });
    await runCleanup(d);
    expect(deleted).toEqual([]);
  });

  it("refuses to delete any album file when the album read looks incomplete", async () => {
    // Two entries but no keys came back: a read that failed quietly. Treating
    // that as "every file is unused" would delete real photographs.
    const { deps: d, deleted } = deps({
      bucket: { "album/pair-1/photo-real.jpg": old },
      albumKeysInUse: async () => new Set<string>(),
      albumItemCount: async () => 2,
    });
    await expect(runCleanup(d)).rejects.toThrow(/refusing to delete/);
    expect(deleted).toEqual([]);
  });
});
