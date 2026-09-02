import { describe, it, expect, vi, beforeEach } from "vitest";

const queries: string[] = [];
let results: unknown[][] = [];

vi.mock("@/lib/db", () => ({
  db: () => (strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push(strings.join("?").replace(/\s+/g, " ").trim());
    void values;
    return Promise.resolve(results.shift() ?? []);
  },
}));

const { POST, GET } = await import("./route");

const IDENTITY = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-8888-4777-8666-555555555555";

const post = (body: unknown) =>
  POST(
    new Request("http://x/api/signal", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );

const join = () =>
  post({ code: "ABCDEF", from: IDENTITY, payload: { kind: "join" } });

/** One inserted row: the room was open. */
const accepted = () => [[{ id: "1" }]];

beforeEach(() => {
  queries.length = 0;
  results = [];
});

describe("the room's day is enforced here", () => {
  it("accepts a signal while the room is open", async () => {
    results = accepted();
    expect((await join()).status).toBe(201);
  });

  it("turns away a signal once the room has closed", async () => {
    // Nothing inserted means the room failed the guard. 410 Gone, not 400:
    // the code was well formed and was real, it is just over.
    results = [[]];
    const res = await join();
    expect(res.status).toBe(410);
  });

  it("turns away a code that was never created", async () => {
    // Same answer, deliberately: signalling is not a place to confirm which
    // six-letter codes exist.
    results = [[]];
    expect((await join()).status).toBe(410);
  });

  it("checks and inserts in one statement", async () => {
    // A SELECT then an INSERT leaves a gap in which the room can expire, and
    // costs a round trip on every ICE candidate.
    results = accepted();
    await join();
    expect(queries[0]).toMatch(/INSERT INTO signals/i);
    expect(queries[0]).toMatch(/WHERE EXISTS/i);
    expect(queries[0]).toMatch(/expires_at > now\(\)/i);
  });

  it("does no other work for a room it has refused", async () => {
    // A stale link can be clicked by anyone; refusing has to stay cheap.
    results = [[]];
    await join();
    expect(queries).toHaveLength(1);
  });

  it("still sweeps old handshake rows after a signal lands", async () => {
    results = accepted();
    await join();
    expect(queries.some((q) => /DELETE FROM signals/i.test(q))).toBe(true);
  });
});

describe("what it still refuses outright", () => {
  it("rejects a malformed room code before any query", async () => {
    const res = await post({ code: "nope", from: IDENTITY, payload: {} });
    expect(res.status).toBe(400);
    expect(queries).toHaveLength(0);
  });

  it("rejects a malformed identity", async () => {
    const res = await post({ code: "ABCDEF", from: "who", payload: {} });
    expect(res.status).toBe(400);
  });

  it("rejects a payload far larger than any handshake", async () => {
    const res = await post({
      code: "ABCDEF",
      from: IDENTITY,
      payload: { blob: "x".repeat(70_000) },
    });
    expect(res.status).toBe(400);
    expect(queries).toHaveLength(0);
  });
});

describe("collecting the other side's signals", () => {
  it("returns the peer's messages and a cursor", async () => {
    results = [[{ id: 7, from_identity: OTHER, payload: { kind: "offer" } }]];
    const res = await GET(
      new Request(`http://x/api/signal?code=ABCDEF&from=${IDENTITY}&after=0`),
    );
    const body = await res.json();
    expect(body.signals).toEqual([{ kind: "offer" }]);
    expect(body.cursor).toBe(7);
  });

  it("is not gated on the room, so a call in progress is never cut off", async () => {
    // Expiry closes the door to new arrivals. It does not end an evening, and
    // polling every 500ms is the wrong place to re-ask the question anyway.
    results = [[]];
    const res = await GET(
      new Request(`http://x/api/signal?code=ABCDEF&from=${IDENTITY}&after=0`),
    );
    expect(res.status).toBe(200);
    expect(queries[0]).not.toMatch(/couples/i);
  });
});
