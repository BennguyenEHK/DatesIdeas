import { beforeEach, describe, expect, it, vi } from "vitest";

const queries: { text: string; values: unknown[] }[] = [];
let results: unknown[][] = [];
// The upload URL carries the content type, so a test can see what was signed.
const presign = vi.fn(async (key: string, contentType: string) => ({
  key,
  uploadUrl: `put:${contentType}:${key}`,
  downloadUrl: `get:${key}`,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: () => (strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push({ text: strings.join("?").replace(/\s+/g, " "), values });
    return Promise.resolve(results.shift() ?? []);
  },
}));
vi.mock("@/lib/storage/objects", () => ({ presignKeepsake: presign }));

const { POST } = await import("./route");
const { isKaraokeKey } = await import("@/lib/karaoke/keys");

const MIB = 1024 * 1024;
const valid = { code: "KW3KDD", bytes: 12 * MIB, contentType: "video/mp4" };

function request(body: unknown) {
  return new Request("http://x/api/karaoke/track", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  queries.length = 0;
  results = [[{ "?column?": 1 }]];
  presign.mockClear();
});

describe("POST /api/karaoke/track", () => {
  it("signs an upload and a download for a song in an open room", async () => {
    const response = await POST(request(valid));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(isKaraokeKey(body.key)).toBe(true);
    expect(body.key).toMatch(/^karaoke\/KW3KDD\//);
    expect(body.uploadUrl).toBe(`put:video/mp4:${body.key}`);
    expect(body.downloadUrl).toBe(`get:${body.key}`);
    expect(presign).toHaveBeenCalledWith(body.key, "video/mp4");
  });

  it("checks that the room is open, case-insensitively, before signing", async () => {
    await POST(request({ ...valid, code: "kw3kdd" }));
    expect(queries).toHaveLength(1);
    expect(queries[0].text).toContain("expires_at > now()");
    expect(queries[0].values).toEqual(["KW3KDD"]);
  });

  it("answers 404 for a room that has closed or never existed", async () => {
    results = [[]];
    const response = await POST(request(valid));
    expect(response.status).toBe(404);
    expect(presign).not.toHaveBeenCalled();
  });

  it("answers 404 for something that is not a room code, without a query", async () => {
    for (const code of ["", "KW3KD", "../../x", 5, undefined]) {
      expect((await POST(request({ ...valid, code }))).status).toBe(404);
    }
    expect(queries).toHaveLength(0);
  });

  it("answers 400 for a body that is not json", async () => {
    expect((await POST(request("not json"))).status).toBe(400);
    expect(presign).not.toHaveBeenCalled();
  });

  it("answers 400 for a size that is not a whole number from 1 byte to 60 MiB", async () => {
    const sizes = [0, -1, 1.5, 60 * MIB + 1, Number.NaN, Infinity, "100", null, undefined];
    for (const bytes of sizes) {
      expect((await POST(request({ ...valid, bytes }))).status).toBe(400);
    }
    expect(presign).not.toHaveBeenCalled();
  });

  it("accepts the smallest and the largest size allowed", async () => {
    results = [[{}], [{}]];
    expect((await POST(request({ ...valid, bytes: 1 }))).status).toBe(200);
    expect((await POST(request({ ...valid, bytes: 60 * MIB }))).status).toBe(200);
  });

  it("answers 400 for any content type but video/mp4", async () => {
    for (const contentType of ["video/webm", "video/mp4; codecs=avc1", "VIDEO/MP4", "", 5, undefined]) {
      expect((await POST(request({ ...valid, contentType }))).status).toBe(400);
    }
    expect(presign).not.toHaveBeenCalled();
  });

  it("does not ask the database about a request that is already invalid", async () => {
    await POST(request({ ...valid, bytes: 0 }));
    expect(queries).toHaveLength(0);
  });

  it("answers 503 when storage is not configured or signing failed", async () => {
    presign.mockResolvedValueOnce(null as never);
    const response = await POST(request(valid));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/not set up/);
  });
});
