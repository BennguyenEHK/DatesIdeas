import { describe, it, expect, vi, beforeEach } from "vitest";

const queries: string[] = [];
const params: unknown[][] = [];
let results: unknown[][] = [];

vi.mock("@/lib/db", () => ({
  db: () => (strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push(strings.join("?").replace(/\s+/g, " ").trim());
    params.push(values);
    return Promise.resolve(results.shift() ?? []);
  },
}));

const { GET, POST } = await import("./route");
const { MAX_REMEMBERED_ROOMS } = await import("@/lib/history/rooms");

const IDENTITY = "11111111-2222-4333-8444-555555555555";
const ask = (qs: string) => GET(new Request(`http://x/api/sessions?${qs}`));
/** The codes handed to the query, whichever parameter they arrived in. */
const codesUsed = () => params[0][0] as string[];

beforeEach(() => {
  queries.length = 0;
  params.length = 0;
  results = [];
});

describe("GET /api/sessions", () => {
  it("still answers a single code", async () => {
    const res = await ask("code=ABCDEF");
    expect(res.status).toBe(200);
    expect(codesUsed()).toEqual(["ABCDEF"]);
  });

  it("reads every room this device remembers", async () => {
    // The whole point: a nightly code would otherwise leave the log empty.
    await ask("codes=ABCDEF,GHJKMN,PQRSTU");
    expect(codesUsed()).toEqual(["ABCDEF", "GHJKMN", "PQRSTU"]);
  });

  it("asks for them all in one query", async () => {
    await ask("codes=ABCDEF,GHJKMN");
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatch(/= ANY/i);
  });

  it("uppercases what it is given", async () => {
    await ask("codes=abcdef,ghjkmn");
    expect(codesUsed()).toEqual(["ABCDEF", "GHJKMN"]);
  });

  it("asks for a repeated code only once", async () => {
    await ask("codes=ABCDEF,ABCDEF,abcdef");
    expect(codesUsed()).toEqual(["ABCDEF"]);
  });

  it("keeps the good codes when one is malformed", async () => {
    // A list built up over months should not be lost to one bad entry.
    await ask("codes=ABCDEF,nope,GHJKMN");
    expect(codesUsed()).toEqual(["ABCDEF", "GHJKMN"]);
  });

  it("refuses when nothing in the list is a room code", async () => {
    const res = await ask("codes=nope,also-nope");
    expect(res.status).toBe(400);
    expect(queries).toHaveLength(0);
  });

  it("refuses an empty request", async () => {
    expect((await ask("")).status).toBe(400);
  });

  it("will not be talked into an unbounded query", async () => {
    // The list is capped on the device, but the URL is not the device.
    const many = Array.from({ length: 500 }, () => "ABCDEF").join(",");
    await ask(`codes=${many}`);
    expect(codesUsed().length).toBeLessThanOrEqual(MAX_REMEMBERED_ROOMS);
  });

  it("returns only evenings that finished, newest first", async () => {
    await ask("code=ABCDEF");
    expect(queries[0]).toMatch(/ended_at IS NOT NULL/i);
    expect(queries[0]).toMatch(/ORDER BY started_at DESC/i);
  });
});

describe("POST /api/sessions", () => {
  const open = (body: unknown) =>
    POST(
      new Request("http://x/api/sessions", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );

  it("opens a session in a room that exists", async () => {
    results = [[{ id: "sess-1" }], []];
    const res = await open({ code: "ABCDEF", identity: IDENTITY });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "sess-1" });
  });

  it("never conjures a room as a side effect of logging history", async () => {
    // It used to insert the couples row here. With rooms now having a life,
    // that would quietly mint a fresh 24 hours for any code posted at it.
    results = [[{ id: "sess-1" }], []];
    await open({ code: "ABCDEF", identity: IDENTITY });
    expect(queries.some((q) => /INSERT INTO couples/i.test(q))).toBe(false);
  });

  it("declines to log an evening in a room that was never opened", async () => {
    results = [[]];
    const res = await open({ code: "ABCDEF", identity: IDENTITY });
    expect(res.status).toBe(410);
  });

  it("still logs an evening whose room expired mid-call", async () => {
    // Expiry closes the door; it does not end the evening, and the evening is
    // exactly what this table is for.
    results = [[{ id: "sess-1" }], []];
    await open({ code: "ABCDEF", identity: IDENTITY });
    expect(queries[0]).not.toMatch(/expires_at/i);
  });

  it("rejects a malformed code before any query", async () => {
    const res = await open({ code: "nope", identity: IDENTITY });
    expect(res.status).toBe(400);
    expect(queries).toHaveLength(0);
  });
});
