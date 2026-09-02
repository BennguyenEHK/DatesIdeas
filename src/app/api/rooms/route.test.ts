import { describe, it, expect, vi, beforeEach } from "vitest";

/** Queue of result sets, handed out one per query, with the SQL recorded. */
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
const { isValidRoomCode } = await import("@/lib/room/code");

const created = (msFromNow: number) => [
  { expires_ms: String(Date.now() + msFromNow) },
];

beforeEach(() => {
  queries.length = 0;
  results = [];
});

describe("POST /api/rooms", () => {
  it("creates a room and says when it closes", async () => {
    results = [created(24 * 3600_000)];
    const res = await POST();
    expect(res.status).toBe(201);

    const body = (await res.json()) as { code: string; expiresAt: string };
    expect(isValidRoomCode(body.code)).toBe(true);
    // An unambiguous instant, not a Postgres-flavoured string the browser has
    // to guess the timezone of.
    expect(body.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it("claims the code in a single statement", async () => {
    // Checking first and inserting second leaves a window where both sides
    // pass the check. The conflict clause has to do the deciding.
    results = [created(3600_000)];
    await POST();
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatch(/ON CONFLICT \(code\) DO UPDATE/i);
  });

  it("only reuses a code whose room has already closed", async () => {
    results = [created(3600_000)];
    await POST();
    // The guard that stops a live evening being handed to somebody else.
    expect(queries[0]).toMatch(/WHERE couples\.expires_at <= now\(\)/i);
  });

  it("tries another code when the first is still in use", async () => {
    // No row back means the conflict target was a live room.
    results = [[], created(3600_000)];
    const res = await POST();
    expect(res.status).toBe(201);
    expect(queries).toHaveLength(2);
  });

  it("gives up rather than looping forever", async () => {
    results = [];
    const res = await POST();
    expect(res.status).toBe(503);
    expect(queries.length).toBeLessThanOrEqual(5);
  });
});

describe("GET /api/rooms", () => {
  const ask = (code: string) =>
    GET(new Request(`http://x/api/rooms?code=${code}`));

  it("reports a live room as open", async () => {
    results = [[{ open: true, expires_ms: String(Date.now() + 3600_000) }]];
    const body = await (await ask("ABCDEF")).json();
    expect(body.status).toBe("open");
  });

  it("reports a room past its day as expired", async () => {
    results = [[{ open: false, expires_ms: String(Date.now() - 1000) }]];
    const body = await (await ask("ABCDEF")).json();
    expect(body.status).toBe("expired");
  });

  it("distinguishes a code that never existed from one that ran out", async () => {
    // These lead to different things to say, so they cannot collapse into one.
    results = [[]];
    const body = await (await ask("ABCDEF")).json();
    expect(body.status).toBe("missing");
    expect(body.expiresAt).toBeNull();
  });

  it("lets the database decide, not the caller's clock", async () => {
    // A browser an hour fast must not be able to talk its way into a room the
    // signalling gate will refuse.
    results = [[{ open: false, expires_ms: String(Date.now() + 9_000_000) }]];
    const body = await (await ask("ABCDEF")).json();
    expect(body.status).toBe("expired");
  });

  it("refuses a malformed code without touching the database", async () => {
    const res = await ask("nope");
    expect(res.status).toBe(400);
    expect(queries).toHaveLength(0);
  });

  it("accepts a lowercase code, since a link may be typed by hand", async () => {
    results = [[{ open: true, expires_ms: String(Date.now() + 3600_000) }]];
    const body = await (await ask("abcdef")).json();
    expect(body.status).toBe("open");
  });
});
