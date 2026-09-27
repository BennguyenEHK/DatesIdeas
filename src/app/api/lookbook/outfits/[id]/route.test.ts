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
const { PATCH, DELETE } = await import("./route");
const pair = { id: "11111111-2222-3333-8444-555555555555", created_at: new Date() },
  params = { params: Promise.resolve({ id: "abcdef" }) },
  req = (method: string, body?: unknown) =>
    new Request("http://x", {
      method,
      headers: {
        authorization: "Bearer abcdefghijklmnopqrstuv",
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
const outfit = {
  id: "abcdef",
  pair_id: pair.id,
  name: "Day",
  wear_on: null,
  note: "",
  created_by: "K",
  loved_by: ["K"],
  layout: [],
  created_at: new Date(),
  updated_at: new Date(),
};
beforeEach(() => {
  queries.length = 0;
  results = [];
});
describe("/api/lookbook/outfits/[id]", () => {
  it("rejects a layout that points at another pair's piece", async () => {
    results = [[pair], []];
    expect(
      (
        await PATCH(
          req("PATCH", { layout: [{ pieceId: "ghijkl", x: 0.5, y: 0.5, scale: 1, z: 0 }] }),
          params,
        )
      ).status,
    ).toBe(400);
  });
  it("adds and removes loves idempotently", async () => {
    results = [[pair], [outfit], [outfit]];
    expect((await PATCH(req("PATCH", { love: { by: "K", on: true } }), params)).status).toBe(200);
    expect(queries.at(-1)).toMatch(/updated_at = now/i);
    results = [[pair], [outfit], [{ ...outfit, loved_by: [] }]];
    expect((await PATCH(req("PATCH", { love: { by: "K", on: false } }), params)).status).toBe(200);
  });
  it("returns not found when another pair owns the outfit", async () => {
    results = [[pair], []];
    expect((await DELETE(req("DELETE"), params)).status).toBe(404);
  });

  it("hearts in one atomic update, so two hearts at once cannot drop either", async () => {
    // Read-then-write let two simultaneous hearts both read the old list, and
    // the second write threw the first heart away. The database now adds or
    // removes the name itself, in the same statement that saves it.
    results = [[pair], [{ ...outfit, loved_by: ["K", "B"] }]];
    expect((await PATCH(req("PATCH", { love: { by: "B", on: true } }), params)).status).toBe(200);
    // One lookup of the pair, then exactly one statement for the outfit.
    expect(queries).toHaveLength(2);
    expect(queries[1]).toMatch(/array_append\(loved_by/);
    expect(queries[1]).toMatch(/array_remove\(loved_by/);
    expect(queries[1]).toMatch(/^UPDATE/i);
  });
});

