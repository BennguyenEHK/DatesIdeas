import { describe, expect, it, vi } from "vitest";
import { ORPHAN_GRACE_MS, runCleanup, type CleanupDeps } from "./cleanup";

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

describe("closed rooms' photo booth folders", () => {
  it("deletes every file in a closed room's folder", async () => {
    const { deps: d, deleted } = deps({
      bucket: {
        "keepsakes/KW3KDD/strip-a.png": old,
        "keepsakes/KW3KDD/clip-a.mp4": old,
      },
    });
    const report = await runCleanup(d);
    expect(deleted.sort()).toEqual(["keepsakes/KW3KDD/clip-a.mp4", "keepsakes/KW3KDD/strip-a.png"]);
    expect(report.closedRoomFolders).toEqual(["KW3KDD"]);
    expect(report.keepsakeFilesDeleted).toBe(2);
  });

  it("leaves a room that is still open alone, however old its files are", async () => {
    // Its QR links still work tonight. Deleting them would break a link
    // somebody may be about to scan.
    const { deps: d, deleted } = deps({
      bucket: { "keepsakes/OPEN12/strip-a.png": old, "keepsakes/SHUT34/strip-b.png": fresh },
      openRoomCodes: async () => new Set(["OPEN12"]),
    });
    const report = await runCleanup(d);
    expect(deleted).toEqual(["keepsakes/SHUT34/strip-b.png"]);
    expect(report.closedRoomFolders).toEqual(["SHUT34"]);
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
    const { deps: d, deleted } = deps({ bucket: { "album/pair-1/photo-stuck.jpg": old } });
    const report = await runCleanup(d);
    expect(deleted).toEqual(["album/pair-1/photo-stuck.jpg"]);
    expect(report.albumOrphansDeleted).toBe(1);
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
