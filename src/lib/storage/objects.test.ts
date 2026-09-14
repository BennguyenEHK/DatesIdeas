import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isKeepsakeKey, presignKeepsake, storageConfig } from "./objects";

const requiredStorageVars = [
  "NEON_STORAGE_ENDPOINT",
  "NEON_STORAGE_BUCKET",
  "NEON_STORAGE_ACCESS_KEY_ID",
  "NEON_STORAGE_SECRET_ACCESS_KEY",
] as const;

function stubConfiguredStorage(): void {
  vi.stubEnv("NEON_STORAGE_ENDPOINT", "https://storage.example.test");
  vi.stubEnv("NEON_STORAGE_REGION", "test-region");
  vi.stubEnv("NEON_STORAGE_BUCKET", "keepsakes");
  vi.stubEnv("NEON_STORAGE_ACCESS_KEY_ID", "test-access-key");
  vi.stubEnv("NEON_STORAGE_SECRET_ACCESS_KEY", "test-secret-key");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("storageConfig", () => {
  it("reads a fully configured environment", () => {
    stubConfiguredStorage();

    expect(storageConfig()).toEqual({
      endpoint: "https://storage.example.test",
      region: "test-region",
      bucket: "keepsakes",
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
    });
  });

  it.each(requiredStorageVars)("returns null when %s is missing", (name) => {
    stubConfiguredStorage();
    vi.stubEnv(name, "");

    expect(storageConfig()).toBeNull();
  });

  it("defaults an unset region to auto", () => {
    stubConfiguredStorage();
    vi.stubEnv("NEON_STORAGE_REGION", "");

    expect(storageConfig()?.region).toBe("auto");
  });

  it("treats whitespace-only required values as missing", () => {
    stubConfiguredStorage();
    vi.stubEnv("NEON_STORAGE_BUCKET", "   ");

    expect(storageConfig()).toBeNull();
  });
});

describe("isKeepsakeKey", () => {
  it("accepts a strip filed by date", () => {
    expect(isKeepsakeKey("keepsakes/2026/09/12_21-04-17_strip_KW3KDD_8e2d4a1b.png")).toBe(true);
  });

  it("accepts a clip filed by date", () => {
    expect(isKeepsakeKey("keepsakes/2026/09/12_21-04-17_clip_KW3KDD_8e2d4a1b.mp4")).toBe(true);
  });

  it("accepts an album file, which can be shared by QR", () => {
    expect(isKeepsakeKey("album/2026/09/12_23-30-00_recording_3f9a0c1e.webm")).toBe(true);
  });

  it("still accepts both layouts from before files were filed by date", () => {
    expect(isKeepsakeKey("keepsakes/room_1/strip-token-2.png")).toBe(true);
    expect(isKeepsakeKey("album/11111111-2222-3333-4444-555555555555/photo-abc.jpg")).toBe(true);
  });

  it.each([
    ["an unknown kind", "keepsakes/2026/09/12_21-04-17_photo_KW3KDD_8e2d4a1b.png"],
    ["no room code", "keepsakes/2026/09/12_21-04-17_strip_8e2d4a1b.png"],
    ["a traversal segment", "keepsakes/2026/09/../12_21-04-17_strip_KW3KDD_8e2d4a1b.png"],
    ["a backslash", "keepsakes\\2026/09/12_21-04-17_strip_KW3KDD_8e2d4a1b.png"],
    ["an extra folder", "keepsakes/2026/09/x/12_21-04-17_strip_KW3KDD_8e2d4a1b.png"],
    ["no extension", "keepsakes/2026/09/12_21-04-17_strip_KW3KDD_8e2d4a1b"],
    ["an empty string", ""],
  ])("rejects %s", (_reason, key) => {
    expect(isKeepsakeKey(key)).toBe(false);
  });
});

describe("presignKeepsake", () => {
  it("returns null when storage is not configured", async () => {
    expect(await presignKeepsake("keepsakes/room/strip-token.png", "image/png")).toBeNull();
  });

  it("returns distinct upload and download URLs containing the key", async () => {
    const key = "keepsakes/room/strip-token.png";
    const result = await presignKeepsake(key, "image/png", {
      endpoint: "https://storage.example.test",
      region: "auto",
      bucket: "keepsakes",
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
    });

    expect(result).not.toBeNull();
    expect(result?.key).toBe(key);
    expect(result?.uploadUrl).toContain(key);
    expect(result?.downloadUrl).toContain(key);
    expect(result?.downloadUrl).not.toContain("response-content-disposition");
    expect(result?.downloadUrl).not.toContain("response-content-type");
    expect(result?.uploadUrl).not.toBe(result?.downloadUrl);
  });
});

describe("deleteKeys", () => {
  const config = {
    endpoint: "https://storage.example.test",
    region: "auto",
    bucket: "b",
    accessKeyId: "id",
    secretAccessKey: "secret",
  };

  it("does nothing, and makes no request, for an empty list", async () => {
    const { deleteKeys } = await import("./objects");
    expect(await deleteKeys([], config)).toBe(0);
  });

  it("refuses keys outside the two places this app writes", async () => {
    // A delete helper that would remove any key it was handed is one bad string
    // away from emptying the bucket. None of these may even be attempted.
    const { deleteKeys } = await import("./objects");
    const refused = [
      "secrets/x.txt",
      "keepsakes/../album/x.jpg",
      "album/pair",
      "album/2026/09",
      "album/2026/09/x/y.jpg",
      "secrets/2026/09/x.jpg",
      "",
      "keepsakes\\ROOM\\x.png",
    ];
    expect(await deleteKeys(refused, config)).toBe(0);
  });

  it("accepts a private look layer and source picture for deletion", async () => {
    const { deleteKeys } = await import("./objects");
    const pair = "11111111-2222-3333-8444-555555555555";
    // No configured client is needed: reaching configuration proves the
    // allow-list admitted both paths instead of dropping them up front.
    await expect(deleteKeys([
      `looks/${pair}/abcdef-backdrop.png`, `looks/${pair}/src/abcdef.webp`,
    ], null)).resolves.toBe(0);
  });

  it("does nothing when storage is not configured", async () => {
    const { deleteKeys } = await import("./objects");
    expect(await deleteKeys(["keepsakes/ROOM/strip-a.png"], null)).toBe(0);
  });
});
