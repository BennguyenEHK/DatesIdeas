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

beforeEach(() => {
  queries.length = 0;
  results = [];
});

describe("POST /api/pair/invite", () => {
  it("refuses a device that is not on an album, without asking the database", async () => {
    const response = await POST(
      new Request("http://x/api/pair/invite", { method: "POST" }),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(queries).toHaveLength(0);
  });

  it("returns a code that lasts five minutes", async () => {
    results = [[pairRow], []];
    const before = Date.now();
    const response = await POST(
      new Request("http://x/api/pair/invite", {
        method: "POST",
        headers: { authorization: `Bearer ${"A".repeat(22)}` },
      }),
    );
    const after = Date.now();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { code: string; expiresAt: number };
    expect(Object.keys(body).sort()).toEqual(["code", "expiresAt"]);
    expect(body.code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(body.expiresAt).toBeGreaterThanOrEqual(before + 5 * 60 * 1000);
    expect(body.expiresAt).toBeLessThanOrEqual(after + 5 * 60 * 1000);
    expect(queries.some((q) => q.includes("INSERT INTO pair_invites"))).toBe(
      true,
    );
    // Minting an invite does not sign anyone in.
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
