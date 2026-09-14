import { beforeEach, describe, expect, it, vi } from "vitest";

const queries: string[] = [];
let results: unknown[][] = [];
const presign = vi.fn(async (key: string) => ({ key, uploadUrl: `put:${key}`, downloadUrl: `get:${key}` }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: () => (strings: TemplateStringsArray) => {
    queries.push(strings.join("?").replace(/\s+/g, " "));
    return Promise.resolve(results.shift() ?? []);
  },
}));
vi.mock("@/lib/storage/objects", () => ({ presignKeepsake: presign }));
const { GET, POST, PUT } = await import("./route");
const { lookReceipt } = await import("@/lib/looks/store");

const ticket = "abcdefghijklmnopqrstuv";
const pair = { id: "11111111-2222-3333-8444-555555555555", created_at: new Date() };
const valid = { name: "Blue hour", shots: 2, ink: "#123abc", backdropBytes: 100, overlayBytes: 100 };
function request(method: string, body?: unknown) {
  return new Request("http://x/api/looks", {
    method,
    headers: { authorization: `Bearer ${ticket}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
beforeEach(() => {
  queries.length = 0;
  results = [];
  vi.stubEnv("NEON_STORAGE_SECRET_ACCESS_KEY", "test-secret");
  presign.mockClear();
});

describe("/api/looks", () => {
  it("requires a paired caller before querying", async () => {
    expect((await GET(new Request("http://x/api/looks"))).status).toBe(401);
    expect(queries).toHaveLength(0);
  });

  it("validates layers and refuses a pair at the cap", async () => {
    results = [[pair]];
    expect((await POST(request("POST", { ...valid, overlayBytes: 9 * 1024 * 1024 }))).status).toBe(400);
    results = [[pair], [{ n: 50 }]];
    expect((await POST(request("POST", valid))).status).toBe(409);
  });

  it("issues pair-bound keys and receipt", async () => {
    results = [[pair], [{ n: 0 }]];
    const body = await (await POST(request("POST", valid))).json();
    expect(body.backdropKey).toMatch(new RegExp(`^looks/${pair.id}/`));
    expect(body.receipt).toBeTruthy();
  });

  it("refuses a receipt tampered for another pair", async () => {
    results = [[pair]];
    const id = "abcdef";
    const backdrop = `looks/${pair.id}/${id}-backdrop.png`;
    const overlay = `looks/${pair.id}/${id}-overlay.png`;
    const receipt = lookReceipt("test-secret", "22222222-2222-4333-8444-555555555555", id, backdrop, overlay);
    expect(
      (await PUT(request("PUT", { id, receipt, name: "Blue hour", shots: 2, ink: "#123abc" }))).status,
    ).toBe(400);
  });

  it("lists newest rows with signed URLs", async () => {
    results = [
      [pair],
      [
        {
          id: "abcdef",
          pair_id: pair.id,
          name: "Blue hour",
          shots: 2,
          ink: "#123abc",
          backdrop_key: `looks/${pair.id}/abcdef-backdrop.png`,
          overlay_key: `looks/${pair.id}/abcdef-overlay.png`,
          created_at: new Date(),
        },
      ],
    ];
    const body = await (await GET(request("GET"))).json();
    expect(body.looks[0]).toMatchObject({ id: "abcdef", backdropUrl: expect.stringContaining("get:") });
  });
});
