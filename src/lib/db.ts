import "server-only";

import { neon } from "@neondatabase/serverless";
import { serverEnv } from "./env";

let client: ReturnType<typeof neon> | null = null;

/**
 * Neon's HTTP driver, which suits Vercel's short-lived request handlers: no
 * pool to keep warm and no connection to leak between invocations.
 *
 * The `server-only` import above turns any accidental client-side import into
 * a build error rather than a leaked credential.
 */
export function db() {
  if (!client) client = neon(serverEnv().databaseUrl);
  return client;
}
