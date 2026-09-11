import { beforeEach, describe, expect, it, vi } from "vitest";

const queries: string[] = [];
let results: unknown[][] = [];
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: () => (strings: TemplateStringsArray, ...values: unknown[]) => {
  void values; queries.push(strings.join("?").replace(/\s+/g, " ")); return Promise.resolve(results.shift() ?? []);
} }));
const { POST } = await import("./route");

beforeEach(() => { queries.length = 0; results = []; });

describe("POST /api/pair", () => {
  it("creates the ticket once and stores it in an HttpOnly cookie", async () => {
    results = [[{ id: "00000000-0000-0000-0000-000000000000", created_at: new Date() }]];
    const response = await POST(new Request("http://x/api/pair", { method: "POST" }));
    expect(response.status).toBe(201);
    expect((await response.json()).ticket).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("refuses to mint a second album for a device that already has one", async () => {
    // The cookie a create sets replaces the only key to the previous pair, and
    // album_items hangs off pairs(id). This is the one request in the app that
    // can silently destroy access to something irreplaceable, so it is guarded
    // rather than merely warned about on the page in front of it.
    const ticket = "A".repeat(22);
    results = [[{ id: "11111111-1111-1111-1111-111111111111", created_at: new Date() }]];
    const response = await POST(
      new Request("http://x/api/pair", {
        method: "POST",
        headers: { authorization: `Bearer ${ticket}` },
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ alreadyPaired: true });
    // Nothing was created, and the existing ticket was not replaced.
    expect(queries.some((q) => q.includes("INSERT INTO pairs"))).toBe(false);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("still creates when the caller means it", async () => {
    const ticket = "A".repeat(22);
    results = [
      [{ id: "11111111-1111-1111-1111-111111111111", created_at: new Date() }],
      [{ id: "22222222-2222-2222-2222-222222222222", created_at: new Date() }],
    ];
    const response = await POST(
      new Request("http://x/api/pair?force=1", {
        method: "POST",
        headers: { authorization: `Bearer ${ticket}` },
      }),
    );
    expect(response.status).toBe(201);
  });

  it("rotates onto the same pair row rather than making a new one", async () => {
    // An INSERT here would leave the whole album attached to an identity
    // nobody can open: revocation that destroys what it protects.
    const ticket = "A".repeat(22);
    results = [
      [{ id: "11111111-1111-1111-1111-111111111111", created_at: new Date() }],
      [{ id: "11111111-1111-1111-1111-111111111111", created_at: new Date() }],
    ];
    const response = await POST(
      new Request("http://x/api/pair?rotate=1", {
        method: "POST",
        headers: { authorization: `Bearer ${ticket}` },
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ticket: string };
    expect(body.ticket).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(body.ticket).not.toBe(ticket);
    expect(queries.some((q) => q.includes("UPDATE pairs"))).toBe(true);
    expect(queries.some((q) => q.includes("INSERT INTO pairs"))).toBe(false);
  });

  it("will not rotate for a caller holding no ticket", async () => {
    const response = await POST(new Request("http://x/api/pair?rotate=1", { method: "POST" }));
    expect(response.status).toBe(401);
  });
});
