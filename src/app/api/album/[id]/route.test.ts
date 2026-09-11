import { beforeEach, describe, expect, it, vi } from "vitest";

const queries: string[] = [];
const bindings: unknown[][] = [];
let results: unknown[][] = [];

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: () => (strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push(strings.join("?").replace(/\s+/g, " "));
    bindings.push(values);
    return Promise.resolve(results.shift() ?? []);
  },
}));

const { PATCH, DELETE } = await import("./route");

const TICKET = "abcdefghijklmnopqrstuv";
const PAIR = "00000000-0000-0000-0000-000000000000";
const pairRow = [{ id: PAIR, created_at: new Date() }];

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function patch(body: unknown, authorized = true): Request {
  return new Request("http://x/api/album/item-1", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(authorized ? { authorization: `Bearer ${TICKET}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  queries.length = 0;
  bindings.length = 0;
  results = [];
});

describe("PATCH /api/album/[id]", () => {
  it("refuses a caller holding no ticket, without asking the database", async () => {
    const response = await PATCH(patch({ loved: true }, false), params("item-1"));
    expect(response.status).toBe(401);
    expect(queries).toHaveLength(0);
  });

  it("scopes the update to the caller's own pair", async () => {
    // An id alone must never be enough to change a row. There is no row-level
    // security behind this: the WHERE clause IS the authorization boundary.
    results = [pairRow, [{ id: "item-1" }]];
    const response = await PATCH(patch({ loved: true }), params("item-1"));
    expect(response.status).toBe(200);
    const update = queries.find((query) => query.includes("UPDATE album_items"));
    expect(update).toMatch(/pair_id\s*=/i);
    expect(bindings.at(-1)).toContain(PAIR);
  });

  it("reports not found when the row belongs to somebody else", async () => {
    // The scoped UPDATE matches nothing, and that is indistinguishable from
    // the row not existing -- which is the correct thing to say either way.
    results = [pairRow, []];
    const response = await PATCH(patch({ loved: true }), params("someone-elses"));
    expect(response.status).toBe(404);
  });

  it("refuses a patch whose fields are the wrong shape", async () => {
    results = [pairRow];
    expect((await PATCH(patch({ loved: "yes" }), params("item-1"))).status).toBe(400);
    results = [pairRow];
    expect((await PATCH(patch({ caption: 42 }), params("item-1"))).status).toBe(400);
  });

  it("clamps a happenedAt from a phone whose clock is years fast", async () => {
    // Left unclamped this parks a photograph at the head of the reel where
    // nothing later can ever displace it.
    results = [pairRow, [{ id: "item-1" }]];
    await PATCH(patch({ happenedAt: "2041-01-01T00:00:00.000Z" }), params("item-1"));
    const sent = bindings.at(-1)?.find(
      (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value),
    );
    expect(String(sent).startsWith("2041")).toBe(false);
  });
});

describe("DELETE /api/album/[id]", () => {
  it("refuses a caller holding no ticket", async () => {
    const request = new Request("http://x/api/album/item-1", { method: "DELETE" });
    expect((await DELETE(request, params("item-1"))).status).toBe(401);
    expect(queries).toHaveLength(0);
  });

  it("scopes the delete to the caller's own pair", async () => {
    results = [pairRow, [{ object_key: `album/${PAIR}/photo-x.jpg`, poster_key: null }]];
    const request = new Request("http://x/api/album/item-1", {
      method: "DELETE",
      headers: { authorization: `Bearer ${TICKET}` },
    });
    const response = await DELETE(request, params("item-1"));
    expect(response.status).toBe(200);
    const statement = queries.find((query) => query.includes("DELETE FROM album_items"));
    expect(statement).toMatch(/pair_id\s*=/i);
  });

  it("reports not found rather than succeeding on somebody else's row", async () => {
    results = [pairRow, []];
    const request = new Request("http://x/api/album/item-1", {
      method: "DELETE",
      headers: { authorization: `Bearer ${TICKET}` },
    });
    expect((await DELETE(request, params("nope"))).status).toBe(404);
  });
});
