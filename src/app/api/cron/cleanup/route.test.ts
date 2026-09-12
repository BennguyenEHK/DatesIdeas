import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runCleanup: vi.fn(),
  storageConfig: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: () => () => Promise.resolve([]) }));
vi.mock("@/lib/storage/cleanup", () => ({ runCleanup: mocks.runCleanup }));
vi.mock("@/lib/storage/objects", () => ({
  storageConfig: mocks.storageConfig,
  listKeys: vi.fn(),
  deleteKeys: vi.fn(),
}));

const { GET } = await import("./route");

const SECRET = "s".repeat(64);
const config = { endpoint: "https://x.test", region: "auto", bucket: "b", accessKeyId: "i", secretAccessKey: "k" };

const call = (authorization?: string) =>
  new Request("http://x/api/cron/cleanup", {
    headers: authorization === undefined ? {} : { authorization },
  });

beforeEach(() => {
  vi.unstubAllEnvs();
  mocks.runCleanup.mockReset();
  mocks.storageConfig.mockReset().mockReturnValue(config);
});

describe("GET /api/cron/cleanup", () => {
  it("refuses to run at all without a configured secret", async () => {
    // An unset secret must never mean "anyone may delete files".
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(call(`Bearer ${SECRET}`))).status).toBe(503);
    expect(mocks.runCleanup).not.toHaveBeenCalled();
  });

  it("refuses a caller without the secret", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    expect((await GET(call())).status).toBe(401);
    expect((await GET(call("Bearer nope"))).status).toBe(401);
    expect(mocks.runCleanup).not.toHaveBeenCalled();
  });

  it("says plainly when storage is not configured", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    mocks.storageConfig.mockReturnValue(null);
    expect((await GET(call(`Bearer ${SECRET}`))).status).toBe(503);
    expect(mocks.runCleanup).not.toHaveBeenCalled();
  });

  it("runs the cleanup and reports what it removed", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const report = { closedRooms: ["KW3KDD"], keepsakeFilesDeleted: 14, keepsakeRowsDeleted: 10, albumOrphansDeleted: 1 };
    mocks.runCleanup.mockResolvedValue(report);
    const response = await GET(call(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(report);
  });

  it("reports the reason when the cleanup refuses to continue", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    mocks.runCleanup.mockRejectedValue(new Error("the album read looks incomplete; refusing to delete any album files"));
    const response = await GET(call(`Bearer ${SECRET}`));
    expect(response.status).toBe(500);
    expect((await response.json()).error).toMatch(/refusing to delete/);
  });
});
