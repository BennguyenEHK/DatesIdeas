import { beforeEach, describe, expect, it, vi } from "vitest";

let results: unknown[][] = [];
const presign = vi.fn(async (key: string) => ({ key, uploadUrl: `put:${key}`, downloadUrl: `get:${key}` }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: () => () => Promise.resolve(results.shift() ?? []) }));
vi.mock("@/lib/storage/objects", () => ({ presignKeepsake: presign }));
const { GET, POST } = await import("./route");
const ticket = "abcdefghijklmnopqrstuv";
const pair = { id: "11111111-2222-3333-8444-555555555555", created_at: new Date() };
function post(body: unknown) {
  return new Request("http://x/api/looks/sources", {
    method: "POST",
    headers: { authorization: `Bearer ${ticket}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  results = [];
  presign.mockClear();
});

describe("/api/looks/sources", () => {
  it("requires pairing and validates source uploads", async () => {
    expect((await POST(new Request("http://x", { method: "POST" }))).status).toBe(401);
    results = [[pair]];
    expect((await POST(post({ contentType: "text/html", sizeBytes: 1 }))).status).toBe(400);
  });
  it("only signs a source path belonging to its caller", async () => {
    results = [[pair]];
    const made = await (await POST(post({ contentType: "image/webp", sizeBytes: 10 }))).json();
    expect(made.key).toMatch(new RegExp(`^looks/${pair.id}/src/`));
    results = [[pair]];
    const other = "looks/22222222-2222-4333-8444-555555555555/src/abcdef.webp";
    const response = await GET(
      new Request(`http://x/api/looks/sources?key=${encodeURIComponent(other)}`, {
        headers: { authorization: `Bearer ${ticket}` },
      }),
    );
    expect(response.status).toBe(400);
    expect(presign).toHaveBeenCalledTimes(1);
  });
});
