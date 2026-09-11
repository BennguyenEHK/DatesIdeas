import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  TICKET_LENGTH,
  hashTicket,
  isTicket,
  newTicket,
  ticketHashesMatch,
} from "./ticket";

describe("newTicket", () => {
  it("is 22 base64url characters, which is 128 bits", () => {
    const ticket = newTicket();
    expect(ticket).toHaveLength(TICKET_LENGTH);
    expect(isTicket(ticket)).toBe(true);
  });

  it("never repeats", () => {
    // Not a randomness test -- it cannot be. It catches the failure that
    // actually happens: a generator wired to a constant seed or a cached value.
    const seen = new Set(Array.from({ length: 500 }, () => newTicket()));
    expect(seen.size).toBe(500);
  });

  it("is safe to put in a URL path without escaping", () => {
    for (let i = 0; i < 200; i += 1) {
      const ticket = newTicket();
      expect(encodeURIComponent(ticket)).toBe(ticket);
    }
  });
});

describe("isTicket", () => {
  it("accepts a real ticket", () => {
    expect(isTicket(newTicket())).toBe(true);
  });

  it("rejects anything that is not one", () => {
    for (const value of [
      "",
      "short",
      `${newTicket()}x`, // too long
      newTicket().slice(1), // too short
      "../../etc/passwd/aaaaa",
      "aaaaaaaaaaaaaaaaaaaaa+", // base64, not base64url
      "aaaaaaaaaaaaaaaaaaaaa/",
      "aaaaaaaaaaaaaaaaaaaa==",
      null,
      undefined,
      42,
      {},
    ]) {
      expect(isTicket(value)).toBe(false);
    }
  });
});

describe("hashTicket", () => {
  it("is stable for the same ticket", () => {
    const ticket = newTicket();
    expect(hashTicket(ticket)).toBe(hashTicket(ticket));
  });

  it("differs for different tickets", () => {
    expect(hashTicket(newTicket())).not.toBe(hashTicket(newTicket()));
  });

  it("never returns the ticket itself", () => {
    // The whole point of the column. Somebody reading the database must not be
    // able to open the album.
    const ticket = newTicket();
    const hash = hashTicket(ticket);
    expect(hash).not.toContain(ticket);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("ticketHashesMatch", () => {
  it("matches a hash against itself", () => {
    const hash = hashTicket(newTicket());
    expect(ticketHashesMatch(hash, hash)).toBe(true);
  });

  it("rejects a different hash", () => {
    expect(ticketHashesMatch(hashTicket(newTicket()), hashTicket(newTicket()))).toBe(
      false,
    );
  });

  it("returns false on a length mismatch instead of throwing", () => {
    // timingSafeEqual throws on unequal lengths. An exception escaping here
    // would be both a crash and, ironically, a timing signal.
    expect(ticketHashesMatch("abc", hashTicket(newTicket()))).toBe(false);
    expect(ticketHashesMatch("", "")).toBe(true);
  });
});
