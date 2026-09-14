import { beforeEach, describe, expect, it, vi } from "vitest";

const queries: string[] = [];
let results: unknown[][] = [];
const deleted = vi.fn().mockResolvedValue(2);
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: () => (strings: TemplateStringsArray) => {
    queries.push(strings.join("?").replace(/\s+/g, " "));
    return Promise.resolve(results.shift() ?? []);
  },
}));
vi.mock("@/lib/storage/objects", () => ({ deleteKeys: deleted }));
const { DELETE } = await import("./route");
const ticket = "abcdefghijklmnopqrstuv";
const pair = { id: "11111111-2222-3333-8444-555555555555", created_at: new Date() };
const params = { params: Promise.resolve({ id: "abcdef" }) };
const request = () =>
  new Request("http://x/api/looks/abcdef", {
    method: "DELETE",
    headers: { authorization: `Bearer ${ticket}` },
  });
beforeEach(() => {
  queries.length = 0;
  results = [];
  deleted.mockClear();
});

describe("DELETE /api/looks/[id]", () => {
  it("requires a pair", async () => expect((await DELETE(new Request("http://x"), params)).status).toBe(401));
  it("does not delete another pair's look", async () => {
    results = [[pair], []];
    expect((await DELETE(request(), params)).status).toBe(404);
    expect(deleted).not.toHaveBeenCalled();
  });
  it("deletes the row scoped to its pair and both layers", async () => {
    results = [
      [pair],
      [
        {
          backdrop_key: `looks/${pair.id}/abcdef-backdrop.png`,
          overlay_key: `looks/${pair.id}/abcdef-overlay.png`,
        },
      ],
    ];
    expect((await DELETE(request(), params)).status).toBe(200);
    expect(queries.at(-1)).toMatch(/pair_id\s*=/i);
    expect(deleted).toHaveBeenCalledWith([
      `looks/${pair.id}/abcdef-backdrop.png`,
      `looks/${pair.id}/abcdef-overlay.png`,
    ]);
  });
});
