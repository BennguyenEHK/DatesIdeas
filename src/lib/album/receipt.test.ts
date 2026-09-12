import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { receiptMatches, receiptSecret, uploadReceipt } from "./receipt";

const SECRET = "test-storage-secret";
const PAIR = "11111111-2222-3333-4444-555555555555";
const OTHER = "99999999-8888-7777-6666-555555555555";
const KEY = "album/2026/09/12_23-30-00_photo_3f9a0c1e.jpg";

afterEach(() => vi.unstubAllEnvs());

describe("upload receipts", () => {
  it("accepts the receipt the server handed out for this pair and key", () => {
    expect(receiptMatches(SECRET, PAIR, KEY, uploadReceipt(SECRET, PAIR, KEY))).toBe(true);
  });

  it("refuses another pair's receipt for the same key", () => {
    // The whole point: a file named for one couple cannot be claimed by another.
    expect(receiptMatches(SECRET, OTHER, KEY, uploadReceipt(SECRET, PAIR, KEY))).toBe(false);
  });

  it("refuses a receipt for a different key", () => {
    const receipt = uploadReceipt(SECRET, PAIR, KEY);
    expect(receiptMatches(SECRET, PAIR, KEY.replace("3f9a0c1e", "00000000"), receipt)).toBe(false);
  });

  it("refuses one signed with a different secret", () => {
    expect(receiptMatches(SECRET, PAIR, KEY, uploadReceipt("another", PAIR, KEY))).toBe(false);
  });

  it("refuses a missing, empty or malformed receipt without throwing", () => {
    for (const receipt of [undefined, null, "", "short", 42, "x".repeat(200)]) {
      expect(receiptMatches(SECRET, PAIR, KEY, receipt)).toBe(false);
    }
  });

  it("reads its secret from the storage configuration", () => {
    vi.stubEnv("NEON_STORAGE_SECRET_ACCESS_KEY", "  from-env  ");
    expect(receiptSecret()).toBe("from-env");
    vi.stubEnv("NEON_STORAGE_SECRET_ACCESS_KEY", "");
    expect(receiptSecret()).toBeNull();
  });
});
