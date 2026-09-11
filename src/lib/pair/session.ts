import "server-only";

import { isTicket } from "./ticket";
import { findPairByTicket, type Pair, type SqlTag } from "./store";

/**
 * How a request proves which pair it belongs to.
 *
 * Two clients, one ticket. The browser gets an HttpOnly cookie, because a
 * secret that stays in a URL leaks into browser history, `Referer` headers,
 * and the link previews chat apps generate on your behalf -- and this one
 * opens the whole album, forever. The Android app gets a bearer header,
 * because Kotlin cannot use an HttpOnly cookie.
 *
 * Both paths resolve through the single function at the bottom of this file.
 * Two ways in are a fact of the product; two implementations of "who is this"
 * would be the bug.
 */

export const TICKET_COOKIE = "festibooth_us";

/** A year. Renewed on every visit, so an app in weekly use never signs out. */
export const TICKET_COOKIE_MAX_AGE_SEC = 365 * 24 * 60 * 60;

export interface CookieAttributes {
  name: string;
  value: string;
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
}

/**
 * The cookie the `/us/<ticket>` route sets.
 *
 * `sameSite: "lax"` rather than "strict" deliberately: the ticket link is
 * opened from a text message, which is a cross-site top-level navigation. Under
 * "strict" the cookie would not be sent on the very redirect that follows, and
 * the app would sign you out at the moment you signed in.
 *
 * `secure` is off only where there is no TLS to be had, which in practice is a
 * developer's machine. Sending this cookie over plaintext anywhere else would
 * hand the album to the network.
 */
export function ticketCookie(
  ticket: string,
  options?: { secure?: boolean },
): CookieAttributes {
  return {
    name: TICKET_COOKIE,
    value: ticket,
    httpOnly: true,
    secure: options?.secure ?? process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TICKET_COOKIE_MAX_AGE_SEC,
  };
}

/** The same cookie, emptied — what rotation and "forget this device" send. */
export function clearedTicketCookie(options?: { secure?: boolean }): CookieAttributes {
  return { ...ticketCookie("", options), maxAge: 0 };
}

/**
 * Pulls a ticket out of a request, from either accepted place.
 *
 * The header is checked first. It is the explicit one: a caller that sends a
 * bearer token means it, whereas a cookie rides along on every request whether
 * anyone intended it or not.
 */
export function ticketFromRequest(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (authorization !== null) {
    const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
    if (match !== null && isTicket(match[1])) return match[1];
    // A malformed Authorization header is a caller error, not an invitation to
    // silently fall back to the cookie of whoever's browser this happens to be.
    return null;
  }

  const cookies = request.headers.get("cookie");
  if (cookies === null) return null;

  for (const part of cookies.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== TICKET_COOKIE) continue;
    const value = decodeURIComponent(part.slice(separator + 1).trim());
    return isTicket(value) ? value : null;
  }

  return null;
}

/**
 * Who this request is, or null.
 *
 * Every route under /api/album and /api/pair begins here. Null means "no pair"
 * and nothing more specific -- see `findPairByTicket` for why the reasons are
 * not distinguished.
 */
export async function pairFromRequest(
  sql: SqlTag,
  request: Request,
): Promise<Pair | null> {
  const ticket = ticketFromRequest(request);
  if (ticket === null) return null;
  return findPairByTicket(sql, ticket);
}
