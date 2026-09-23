import { beforeEach, describe, expect, it, vi } from "vitest";

const queries: string[] = [];
let results: unknown[][] = [];
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db:
    () =>
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      void values;
      queries.push(strings.join("?").replace(/\s+/g, " "));
      return Promise.resolve(results.shift() ?? []);
    },
}));
const { POST } = await import("./route");

const PAIR_ID = "11111111-1111-1111-1111-111111111111";
const GOOD_CODE = "B".repeat(22);

function claim(body: unknown): Promise<Response> {
  return POST(
    new Request("http://x/api/pair/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  queries.length = 0;
  results = [];
});

describe("POST /api/pair/claim", () => {
  it("redeems a good code for a key of this device's own, in its cookie", async () => {
    results = [[{ pair_id: PAIR_ID }], [{ id: "k" }]];
    const response = await claim({ code: GOOD_CODE });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { paired: boolean; keyId: string };
    expect(body.paired).toBe(true);
    expect(body.keyId).toMatch(/^[0-9a-f]{16}$/);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^festibooth_us=[A-Za-z0-9_-]{22};/);
    expect(cookie).toContain("HttpOnly");
    // The invite was marked used and a key was added for its pair.
    expect(queries[0]).toContain("UPDATE pair_invites SET used_at = now()");
    expect(queries[1]).toContain("INSERT INTO pair_keys");
    // The ticket reaches the browser only through the HttpOnly cookie.
    expect(JSON.stringify(body)).not.toContain(
      cookie.split(";")[0].split("=")[1],
    );
  });

  it("gives the same 401 for an expired, used or unknown code", async () => {
    // Each of these is the claim statement matching no row: Postgres cannot
    // tell the route which condition failed, and the route tells nobody.
    const bodies: unknown[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      results = [[]];
      const response = await claim({ code: GOOD_CODE });
      expect(response.status).toBe(401);
      expect(response.headers.get("set-cookie")).toBeNull();
      bodies.push(await response.json());
    }
    expect(bodies).toEqual([
      { error: "unauthorized" },
      { error: "unauthorized" },
      { error: "unauthorized" },
    ]);
    expect(queries.some((q) => q.includes("INSERT INTO pair_keys"))).toBe(
      false,
    );
  });

  it("refuses a second claim of the same code", async () => {
    results = [[{ pair_id: PAIR_ID }], [{ id: "k" }], []];
    expect((await claim({ code: GOOD_CODE })).status).toBe(200);
    const second = await claim({ code: GOOD_CODE });
    expect(second.status).toBe(401);
    expect(await second.json()).toEqual({ error: "unauthorized" });
  });

  it("gives the same 401 for a malformed code, without asking the database", async () => {
    for (const body of [{ code: "short" }, { code: 42 }, {}, "not json"]) {
      const response = await claim(body);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized" });
    }
    expect(queries).toHaveLength(0);
  });
});
