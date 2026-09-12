import "server-only";

import { timingSafeEqual } from "node:crypto";

/**
 * Whether a request holds the cron secret.
 *
 * Shared by every scheduled route, so there is exactly one implementation of
 * the check that stands between the internet and "delete files" or "push to
 * every couple".
 *
 * Vercel sends `Authorization: Bearer <CRON_SECRET>` on its own when that
 * variable is set. Compared in constant time, both sides padded to one length
 * first, the same way the helper route guards its token.
 */
export function cronAuthorised(request: Request, secret: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const length = Math.max(supplied.length, secret.length, 1);
  const expected = Buffer.from(secret.padEnd(length, "\0"));
  const given = Buffer.from(supplied.padEnd(length, "\0"));
  return timingSafeEqual(expected, given) && supplied.length === secret.length;
}
