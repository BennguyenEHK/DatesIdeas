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

const pairRow = {
  id: "11111111-1111-1111-1111-111111111111",
  created_at: new Date(),
};
const OWN_KEY = "aaaaaaaaaaaaaaaa";
const OTHER_KEY = "bbbbbbbbbbbbbbbb";

function revoke(keyId: unknown, paired = true): Promise<Response> {
  return POST(
    new Request("http://x/api/pair/revoke", {
      method: "POST",
      headers: paired
        ? {
            authorization: `Bearer ${"A".repeat(22)}`,
            "content-type": "application/json",
          }
        : { "content-type": "application/json" },
      body: JSON.stringify({ keyId }),
    }),
  );
}

beforeEach(() => {
  queries.length = 0;
  results = [];
});

describe("POST /api/pair/revoke", () => {
  it("refuses a device that is not on an album", async () => {
    const response = await revoke(OTHER_KEY, false);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(queries).toHaveLength(0);
  });

  it("takes another device off the album", async () => {
    results = [[pairRow], [{ id: OWN_KEY }], [{ id: OTHER_KEY }]];
    const response = await revoke(OTHER_KEY);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revoked: true });
    expect(queries[2]).toContain("DELETE FROM pair_keys");
  });

  it("refuses the caller's own key, and deletes nothing", async () => {
    results = [[pairRow], [{ id: OWN_KEY }]];
    const response = await revoke(OWN_KEY);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "that is this device's key",
    });
    expect(queries.some((q) => q.includes("DELETE FROM pair_keys"))).toBe(
      false,
    );
  });

  it("reads another pair's key as unknown", async () => {
    // The delete is scoped by the caller's pair, so it matches nothing.
    results = [[pairRow], [{ id: OWN_KEY }], []];
    const response = await revoke(OTHER_KEY);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "unknown key" });
    expect(queries[2]).toContain("pair_id = ?");
  });

  it("reads a missing key id as unknown, without trying to delete", async () => {
    results = [[pairRow]];
    const response = await revoke(undefined);
    expect(response.status).toBe(404);
    expect(queries.some((q) => q.includes("DELETE FROM pair_keys"))).toBe(
      false,
    );
  });
});
