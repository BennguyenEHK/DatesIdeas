import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { mintHelperToken, verifyHelperToken, TOKEN_LIFETIME_MS } = await import(
  "./helperToken"
);

const SECRET = "a-shared-secret-between-app-and-helper";
const NOW = 1_700_000_000_000;

describe("mintHelperToken / verifyHelperToken", () => {
  it("accepts a token it just minted", () => {
    const token = mintHelperToken(SECRET, NOW + TOKEN_LIFETIME_MS);
    expect(verifyHelperToken(SECRET, token, NOW)).toBe(true);
  });

  it("rejects a token signed with a different secret", () => {
    const token = mintHelperToken("someone-elses-secret", NOW + TOKEN_LIFETIME_MS);
    expect(verifyHelperToken(SECRET, token, NOW)).toBe(false);
  });

  it("rejects a token whose expiry has passed", () => {
    const token = mintHelperToken(SECRET, NOW + 1000);
    expect(verifyHelperToken(SECRET, token, NOW + 1001)).toBe(false);
  });

  it("rejects a token expiring exactly now", () => {
    const token = mintHelperToken(SECRET, NOW);
    expect(verifyHelperToken(SECRET, token, NOW)).toBe(false);
  });

  it("rejects an expiry moved forward without re-signing", () => {
    // The whole point of the signature: the deadline is not something the
    // holder of a token gets to edit.
    const token = mintHelperToken(SECRET, NOW + 1000);
    const signature = token.slice(token.indexOf(".") + 1);
    const extended = `${NOW + 999_999}.${signature}`;
    expect(verifyHelperToken(SECRET, extended, NOW)).toBe(false);
  });

  it("rejects a tampered signature of the right length", () => {
    const token = mintHelperToken(SECRET, NOW + TOKEN_LIFETIME_MS);
    const flipped =
      token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
    expect(verifyHelperToken(SECRET, flipped, NOW)).toBe(false);
  });

  it.each([
    ["empty", ""],
    ["no separator", "abcdef"],
    ["separator first", ".abcdef"],
    ["no signature", `${NOW + 1000}.`],
    ["non-numeric expiry", "later.abcdef"],
    ["float expiry", `${NOW + 0.5}.abcdef`],
    ["signature only", "deadbeef"],
  ])("rejects a malformed token without throwing: %s", (_label, token) => {
    expect(() => verifyHelperToken(SECRET, token, NOW)).not.toThrow();
    expect(verifyHelperToken(SECRET, token, NOW)).toBe(false);
  });

  it("mints a different signature for a different expiry", () => {
    const a = mintHelperToken(SECRET, NOW + 1000);
    const b = mintHelperToken(SECRET, NOW + 2000);
    expect(a).not.toBe(b);
  });

  it("never contains the secret", () => {
    const token = mintHelperToken(SECRET, NOW + TOKEN_LIFETIME_MS);
    expect(token).not.toContain(SECRET);
  });
});
