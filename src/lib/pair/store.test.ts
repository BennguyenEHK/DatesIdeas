import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  addKey,
  createPair,
  findPairByTicket,
  keyIdForTicket,
  revokeKey,
  rotateTicket,
} from "./store";
import { hashTicket, newTicket } from "./ticket";

interface Query {
  text: string;
  values: unknown[];
}

const queries: Query[] = [];
let results: unknown[][] = [];

/** A fake Neon tag: records each statement and answers from a queue. */
function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  queries.push({ text: strings.join("?").replace(/\s+/g, " ").trim(), values });
  return Promise.resolve(results.shift() ?? []);
}

const PAIR_ID = "11111111-1111-1111-1111-111111111111";
const pairRow = { id: PAIR_ID, created_at: new Date("2026-01-01T00:00:00Z") };

beforeEach(() => {
  queries.length = 0;
  results = [];
});

describe("findPairByTicket", () => {
  it("finds a device's key in pair_keys and notes the visit in the same statement", async () => {
    const ticket = newTicket();
    results = [[pairRow]];
    const pair = await findPairByTicket(sql, ticket);
    expect(pair).toEqual({
      id: PAIR_ID,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(queries).toHaveLength(1);
    expect(queries[0].text).toContain(
      "UPDATE pair_keys SET last_seen_at = now()",
    );
    expect(queries[0].values).toContain(hashTicket(ticket));
    // The ticket itself never reaches the database, only its hash.
    expect(queries[0].values).not.toContain(ticket);
  });

  it("falls back to pairs.key_hash when pair_keys has no match", async () => {
    const ticket = newTicket();
    results = [[], [pairRow]];
    const pair = await findPairByTicket(sql, ticket);
    expect(pair).toEqual({
      id: PAIR_ID,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(queries).toHaveLength(2);
    expect(queries[1].text).toContain(
      "SELECT id, created_at FROM pairs WHERE key_hash",
    );
    expect(queries[1].values).toEqual([hashTicket(ticket)]);
  });

  it("is null when neither place knows the ticket", async () => {
    results = [[], []];
    expect(await findPairByTicket(sql, newTicket())).toBeNull();
    expect(queries).toHaveLength(2);
  });

  it("refuses a malformed ticket without a query", async () => {
    expect(await findPairByTicket(sql, "not-a-ticket")).toBeNull();
    expect(queries).toHaveLength(0);
  });
});

describe("createPair", () => {
  it("writes the first key into pair_keys along with the pair, in one statement", async () => {
    results = [[pairRow]];
    const created = await createPair(sql);
    expect(created).not.toBeNull();
    expect(created?.pair.id).toBe(PAIR_ID);
    expect(queries).toHaveLength(1);
    expect(queries[0].text).toContain("INSERT INTO pairs");
    expect(queries[0].text).toContain("INSERT INTO pair_keys");
    // The same hash goes into both places.
    const hash = hashTicket(created?.ticket ?? "");
    expect(queries[0].values.filter((value) => value === hash)).toHaveLength(2);
  });
});

describe("rotateTicket", () => {
  it("deletes every key for the pair, inserts one, and updates pairs.key_hash", async () => {
    results = [[pairRow]];
    const ticket = await rotateTicket(sql, PAIR_ID);
    expect(ticket).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(queries).toHaveLength(1);
    const { text, values } = queries[0];
    expect(text).toContain("UPDATE pairs SET key_hash");
    expect(text).toContain("DELETE FROM pair_keys WHERE pair_id");
    expect(text).toContain("INSERT INTO pair_keys");
    expect(text).not.toContain("INSERT INTO pairs");
    expect(values).toContain(PAIR_ID);
    expect(
      values.filter((value) => value === hashTicket(ticket ?? "")),
    ).toHaveLength(2);
  });

  it("is null for a pair that does not exist", async () => {
    results = [[]];
    expect(await rotateTicket(sql, PAIR_ID)).toBeNull();
  });
});

describe("addKey", () => {
  it("adds a key for the pair and returns its id and ticket", async () => {
    results = [[{ id: "whatever" }]];
    const key = await addKey(sql, PAIR_ID);
    expect(key).not.toBeNull();
    expect(key?.keyId).toMatch(/^[0-9a-f]{16}$/);
    expect(key?.ticket).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(queries[0].text).toContain("INSERT INTO pair_keys");
    expect(queries[0].values).toEqual([
      key?.keyId,
      hashTicket(key?.ticket ?? ""),
      PAIR_ID,
    ]);
  });

  it("is null when the pair is gone", async () => {
    results = [[]];
    expect(await addKey(sql, PAIR_ID)).toBeNull();
  });
});

describe("revokeKey", () => {
  it("deletes a key scoped to its pair", async () => {
    results = [[{ id: "abc" }]];
    expect(await revokeKey(sql, PAIR_ID, "abc")).toBe(true);
    expect(queries[0].text).toContain("DELETE FROM pair_keys");
    expect(queries[0].text).toContain("pair_id = ?");
    expect(queries[0].values).toEqual(["abc", PAIR_ID, PAIR_ID]);
  });

  it("refuses the last key, in the same statement as the delete", async () => {
    // With one key left the count guard matches nothing, so nothing is
    // deleted and the fake answers with no rows, as Postgres would.
    results = [[]];
    expect(await revokeKey(sql, PAIR_ID, "abc")).toBe(false);
    expect(queries).toHaveLength(1);
    expect(queries[0].text).toContain(
      "(SELECT count(*) FROM pair_keys WHERE pair_id = ?) > 1",
    );
  });
});

describe("keyIdForTicket", () => {
  it("names the key a ticket belongs to", async () => {
    const ticket = newTicket();
    results = [[{ id: "0123456789abcdef" }]];
    expect(await keyIdForTicket(sql, ticket)).toBe("0123456789abcdef");
    expect(queries[0].values).toEqual([hashTicket(ticket)]);
  });

  it("is null for an unknown or malformed ticket", async () => {
    results = [[]];
    expect(await keyIdForTicket(sql, newTicket())).toBeNull();
    expect(await keyIdForTicket(sql, "nope")).toBeNull();
    expect(queries).toHaveLength(1);
  });
});
