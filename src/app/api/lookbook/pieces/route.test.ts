import { beforeEach, describe, expect, it, vi } from "vitest";
const queries: string[] = [];
let results: unknown[][] = [];
const presign = vi.fn(async (key: string) => ({
  key,
  uploadUrl: `put:${key}`,
  downloadUrl: `get:${key}`,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: () => (s: TemplateStringsArray) => {
    queries.push(s.join("?"));
    return Promise.resolve(results.shift() ?? []);
  },
}));
vi.mock("@/lib/storage/objects", () => ({ presignKeepsake: presign }));
const { GET, POST, PUT } = await import("./route");
const { pieceReceipt } = await import("@/lib/lookbook/store");
const pair = { id: "11111111-2222-3333-8444-555555555555", created_at: new Date() },
  ticket = "abcdefghijklmnopqrstuv",
  req = (method: string, body?: unknown) =>
    new Request("http://x/api/lookbook/pieces", {
      method,
      headers: { authorization: `Bearer ${ticket}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
beforeEach(() => {
  queries.length = 0;
  results = [];
  vi.stubEnv("NEON_STORAGE_SECRET_ACCESS_KEY", "secret");
  presign.mockClear();
});
describe("/api/lookbook/pieces", () => {
  it("requires a pair before querying", async () => {
    expect((await GET(new Request("http://x"))).status).toBe(401);
    expect(queries).toHaveLength(0);
  });
  it("rejects invalid upload fields and enforces the cap", async () => {
    results = [[pair]];
    expect((await POST(req("POST", { contentType: "text/plain", bytes: 1 }))).status).toBe(400);
    results = [[pair], [{ n: 200 }]];
    expect((await POST(req("POST", { contentType: "image/jpeg", bytes: 1 }))).status).toBe(409);
  });
  it("rejects another pair's key and a mismatched receipt", async () => {
    const id = "abcdef",
      key = `lookbook/${pair.id}/${id}.jpg`,
      body = {
        id,
        key,
        contentType: "image/jpeg",
        bytes: 1,
        kind: "top",
        label: "",
        addedBy: "K",
        receipt: pieceReceipt(
          "secret",
          "22222222-2222-4333-8444-555555555555",
          id,
          key,
          "image/jpeg",
          1,
        ),
      };
    results = [[pair]];
    expect((await PUT(req("PUT", body))).status).toBe(400);
    results = [[pair]];
    expect(
      (
        await PUT(
          req("PUT", { ...body, key: "lookbook/22222222-2222-4333-8444-555555555555/abcdef.jpg" }),
        )
      ).status,
    ).toBe(400);
  });
  it("skips individual unsigned pieces but reports unavailable when none can be signed", async () => {
    const row = {
      id: "abcdef",
      pair_id: pair.id,
      object_key: `lookbook/${pair.id}/abcdef.jpg`,
      content_type: "image/jpeg",
      bytes: 1,
      kind: "top",
      label: "",
      added_by: "K",
      created_at: new Date(),
    };
    results = [[pair], [row]];
    presign.mockResolvedValueOnce(null as never);
    expect((await GET(req("GET"))).status).toBe(503);
  });
});
