import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const queries: string[] = [];
let results: unknown[][] = [];
const { listItems } = await import("./items");

beforeEach(() => { queries.length = 0; results = []; });

describe("listItems", () => {
  it("uses created_at, rather than the backdateable happened_at, for its cursor", async () => {
    results = [[]];
    await listItems((strings: TemplateStringsArray, ...values: unknown[]) => {
      void values;
      queries.push(strings.join("?").replace(/\s+/g, " "));
      return Promise.resolve(results.shift() ?? []);
    }, "00000000-0000-0000-0000-000000000000", "2026-01-02T00:00:00.000Z");
    expect(queries[0]).toMatch(/created_at\s*>/i);
    expect(queries[0]).not.toMatch(/happened_at\s*>/i);
  });
});
