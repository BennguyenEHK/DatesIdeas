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
});
