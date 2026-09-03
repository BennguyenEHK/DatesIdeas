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
  it("accepts a strip key", () => {
    expect(isKeepsakeKey("keepsakes/room_1/strip-token-2.png")).toBe(true);
  });

  it("accepts a clip key", () => {
    expect(isKeepsakeKey("keepsakes/room-1/clip-token_2.mp4")).toBe(true);
  });

  it.each([
    ["an unknown kind", "keepsakes/room/photo-token.png"],
    ["a traversal segment", "keepsakes/room/strip-..token.png"],
    ["a backslash", "keepsakes\\room/strip-token.png"],
    ["a slash inside the room", "keepsakes/room/extra/strip-token.png"],
    ["no extension", "keepsakes/room/strip-token"],
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
