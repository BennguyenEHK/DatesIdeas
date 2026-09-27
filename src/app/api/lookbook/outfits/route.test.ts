import { beforeEach, describe, expect, it, vi } from "vitest";
const queries: string[] = [];
let results: unknown[][] = [];
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: () => (s: TemplateStringsArray) => {
    queries.push(s.join("?"));
    return Promise.resolve(results.shift() ?? []);
  },
}));
const { GET, POST } = await import("./route");
const pair = { id: "11111111-2222-3333-8444-555555555555", created_at: new Date() },
  ticket = "abcdefghijklmnopqrstuv",
  request = (url: string, method = "GET", body?: unknown) =>
    new Request(url, {
      method,
      headers: { authorization: `Bearer ${ticket}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
beforeEach(() => {
  queries.length = 0;
  results = [];
});
describe("/api/lookbook/outfits", () => {
  it("requires authorization and validates calendar ranges", async () => {
    expect((await GET(new Request("http://x"))).status).toBe(401);
    results = [[pair]];
    expect(
      (await GET(request("http://x/api/lookbook/outfits?from=2026-02-30&to=2026-03-01"))).status,
    ).toBe(400);
    results = [[pair]];
    expect(
      (await GET(request("http://x/api/lookbook/outfits?from=2026-01-01&to=2026-04-05"))).status,
    ).toBe(400);
  });
  it("rejects invalid outfit fields and enforces the cap", async () => {
    results = [[pair]];
    expect((await POST(request("http://x", "POST", { name: " ", createdBy: "K" }))).status).toBe(
      400,
    );
    results = [[pair], [{ n: 100 }]];
    expect((await POST(request("http://x", "POST", { name: "Day", createdBy: "K" }))).status).toBe(
      409,
    );
  });
});
