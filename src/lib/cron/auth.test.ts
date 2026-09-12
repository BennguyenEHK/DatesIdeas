import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { cronAuthorised } = await import("./auth");

const SECRET = "c".repeat(64);
const call = (authorization?: string) =>
  new Request("http://x/api/cron/anything", {
    headers: authorization === undefined ? {} : { authorization },
  });

describe("cronAuthorised", () => {
  it("accepts the exact secret as a bearer token", () => {
    expect(cronAuthorised(call(`Bearer ${SECRET}`), SECRET)).toBe(true);
  });

  it("refuses no header, a different secret, and a secret with extra on the end", () => {
    expect(cronAuthorised(call(), SECRET)).toBe(false);
    expect(cronAuthorised(call("Bearer wrong"), SECRET)).toBe(false);
    expect(cronAuthorised(call(`Bearer ${SECRET}x`), SECRET)).toBe(false);
    expect(cronAuthorised(call(`Bearer ${SECRET.slice(1)}`), SECRET)).toBe(false);
  });

  it("refuses the secret sent without the Bearer scheme", () => {
    expect(cronAuthorised(call(SECRET), SECRET)).toBe(false);
  });
});
