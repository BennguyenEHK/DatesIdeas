import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { INVITE_TTL_MS, claimInvite, createInvite } from "./invites";
import { hashTicket, newTicket } from "./ticket";

interface Query {
  text: string;
  values: unknown[];
}

const queries: Query[] = [];
let results: unknown[][] = [];

function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  queries.push({ text: strings.join("?").replace(/\s+/g, " ").trim(), values });
  return Promise.resolve(results.shift() ?? []);
}

const PAIR_ID = "11111111-1111-1111-1111-111111111111";
const NOW = Date.parse("2026-09-22T12:00:00Z");

beforeEach(() => {
  queries.length = 0;
  results = [];
});

describe("createInvite", () => {
  it("returns a ticket-shaped code that lasts five minutes, and stores only its hash", async () => {
    const invite = await createInvite(sql, PAIR_ID, NOW);
    expect(invite.code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(invite.expiresAt).toBe(NOW + 5 * 60 * 1000);
    expect(INVITE_TTL_MS).toBe(5 * 60 * 1000);
    expect(queries).toHaveLength(1);
    expect(queries[0].text).toContain("INSERT INTO pair_invites");
    expect(queries[0].values).toEqual([
      hashTicket(invite.code),
      PAIR_ID,
      new Date(NOW + 5 * 60 * 1000).toISOString(),
    ]);
    expect(queries[0].values).not.toContain(invite.code);
  });

  it("mints a different code every time", async () => {
    const first = await createInvite(sql, PAIR_ID, NOW);
    const second = await createInvite(sql, PAIR_ID, NOW);
    expect(first.code).not.toBe(second.code);
  });
});

describe("claimInvite", () => {
  it("checks and marks the code used in one statement", async () => {
    const code = newTicket();
    results = [[{ pair_id: PAIR_ID }]];
    expect(await claimInvite(sql, code, NOW)).toEqual({ pairId: PAIR_ID });
    expect(queries).toHaveLength(1);
    const { text, values } = queries[0];
    expect(text).toContain("UPDATE pair_invites SET used_at = now()");
    expect(text).toContain("used_at IS NULL");
    expect(text).toContain("expires_at > ?");
    expect(text).toContain("RETURNING pair_id");
    expect(values).toEqual([hashTicket(code), new Date(NOW).toISOString()]);
  });

  it("is null when the statement matches nothing: used, expired or unknown", async () => {
    results = [[]];
    expect(await claimInvite(sql, newTicket(), NOW)).toBeNull();
    expect(queries).toHaveLength(1);
  });

  it("refuses a malformed code without a query", async () => {
    expect(await claimInvite(sql, "short", NOW)).toBeNull();
    expect(await claimInvite(sql, "!".repeat(22), NOW)).toBeNull();
    expect(queries).toHaveLength(0);
  });
});
