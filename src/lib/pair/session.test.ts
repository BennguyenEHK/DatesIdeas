import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  TICKET_COOKIE,
  clearedTicketCookie,
  pairFromRequest,
  ticketCookie,
  ticketFromRequest,
} from "./session";
import { newTicket } from "./ticket";

function requestWith(headers: Record<string, string>): Request {
  return new Request("https://festibooth.test/api/album", { headers });
}

describe("ticketFromRequest", () => {
  it("reads a bearer token", () => {
    const ticket = newTicket();
    expect(ticketFromRequest(requestWith({ authorization: `Bearer ${ticket}` }))).toBe(
      ticket,
    );
  });

  it("accepts the header however it is cased", () => {
    const ticket = newTicket();
    expect(ticketFromRequest(requestWith({ authorization: `bearer ${ticket}` }))).toBe(
      ticket,
    );
  });

  it("reads the cookie", () => {
    const ticket = newTicket();
    expect(
      ticketFromRequest(requestWith({ cookie: `${TICKET_COOKIE}=${ticket}` })),
    ).toBe(ticket);
  });

  it("finds the cookie among others", () => {
    const ticket = newTicket();
    const cookie = `theme=dark; ${TICKET_COOKIE}=${ticket}; other=1`;
    expect(ticketFromRequest(requestWith({ cookie }))).toBe(ticket);
  });

  it("does not fall back to the cookie when a bearer header is malformed", () => {
    // A caller that sends Authorization means it. Quietly using whatever
    // cookie the browser happened to attach would authenticate a request as
    // somebody the caller never claimed to be.
    const ticket = newTicket();
    const request = requestWith({
      authorization: "Bearer not-a-ticket",
      cookie: `${TICKET_COOKIE}=${ticket}`,
    });
    expect(ticketFromRequest(request)).toBeNull();
  });

  it("rejects a cookie that is not shaped like a ticket", () => {
    expect(
      ticketFromRequest(requestWith({ cookie: `${TICKET_COOKIE}=../../secret` })),
    ).toBeNull();
  });

  it("returns null when there is nothing to read", () => {
    expect(ticketFromRequest(requestWith({}))).toBeNull();
    expect(ticketFromRequest(requestWith({ cookie: "theme=dark" }))).toBeNull();
  });
});

describe("ticketCookie", () => {
  it("is HttpOnly, Lax and site-wide", () => {
    const cookie = ticketCookie(newTicket(), { secure: true });
    expect(cookie.httpOnly).toBe(true);
    // Strict would not be sent on the top-level navigation from the ticket
    // link itself, signing you out at the moment you signed in.
    expect(cookie.sameSite).toBe("lax");
    expect(cookie.path).toBe("/");
    expect(cookie.secure).toBe(true);
  });

  it("clears by expiring immediately, keeping every other attribute", () => {
    const cleared = clearedTicketCookie({ secure: true });
    expect(cleared.maxAge).toBe(0);
    expect(cleared.value).toBe("");
    expect(cleared.httpOnly).toBe(true);
  });
});

describe("pairFromRequest", () => {
  const pairRow = [{ id: "11111111-2222-3333-4444-555555555555", created_at: "2026-01-01" }];

  it("resolves the pair a valid ticket opens", async () => {
    const sql = () => Promise.resolve(pairRow);
    const request = requestWith({ authorization: `Bearer ${newTicket()}` });
    const pair = await pairFromRequest(sql, request);
    expect(pair?.id).toBe("11111111-2222-3333-4444-555555555555");
  });

  it("never queries when there is no ticket at all", async () => {
    let asked = 0;
    const sql = () => {
      asked += 1;
      return Promise.resolve([]);
    };
    expect(await pairFromRequest(sql, requestWith({}))).toBeNull();
    expect(asked).toBe(0);
  });

  it("never queries for a malformed ticket", async () => {
    // This route is reachable by anyone. A malformed ticket must cost us a
    // regex, not a database round trip.
    let asked = 0;
    const sql = () => {
      asked += 1;
      return Promise.resolve([]);
    };
    const request = requestWith({ cookie: `${TICKET_COOKIE}=nope` });
    expect(await pairFromRequest(sql, request)).toBeNull();
    expect(asked).toBe(0);
  });

  it("returns null for a well-formed ticket nobody holds", async () => {
    const sql = () => Promise.resolve([]);
    const request = requestWith({ authorization: `Bearer ${newTicket()}` });
    expect(await pairFromRequest(sql, request)).toBeNull();
  });
});
