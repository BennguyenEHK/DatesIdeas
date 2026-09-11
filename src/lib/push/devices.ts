import "server-only";

/**
 * Where a pair's pushes can be delivered.
 *
 * Same SqlTag shape as the album's data module, for the same reason: callers
 * pass Neon directly, and tests pass something trivially fake.
 */
export type SqlTag = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Record<string, unknown>[]>;

type QueryTag = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => PromiseLike<unknown>;

export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  label?: string | null;
}

export interface Device {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Whether this looks like a push endpoint we should keep.
 *
 * The value comes from the browser's own PushManager rather than from a person,
 * so this is a sanity check and not a security boundary -- but it is stored and
 * later used as a request URL by the server, and a server that will POST to any
 * string a client hands it is a request-forgery gadget. https only, and no
 * credentials smuggled into the authority.
 */
export function isPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "") return false;
  return true;
}

function readDevice(value: unknown): Device | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.endpoint !== "string" ||
    typeof row.p256dh !== "string" ||
    typeof row.auth !== "string"
  ) {
    return null;
  }
  return { id: row.id, endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth };
}

/**
 * Records a subscription, or moves an existing one to this pair.
 *
 * The conflict clause is the whole point. A browser re-subscribes on its own
 * schedule -- after a permission reset, a service worker update, or the push
 * service rotating it -- and hands back the same endpoint. Inserting blindly
 * would fail; ignoring the conflict would leave a device pointing at an album
 * it has since left.
 */
export async function rememberDevice(
  sql: QueryTag,
  pairId: string,
  subscription: PushSubscriptionInput,
): Promise<string | null> {
  const rows = await sql`
    INSERT INTO pair_devices (pair_id, endpoint, p256dh, auth, label)
    VALUES (${pairId}, ${subscription.endpoint}, ${subscription.p256dh},
            ${subscription.auth}, ${subscription.label ?? null})
    ON CONFLICT (endpoint) DO UPDATE SET
      pair_id = excluded.pair_id,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      label = coalesce(excluded.label, pair_devices.label),
      last_seen_at = now(),
      -- A device that has just proved it is alive is not failed any more.
      failed_at = NULL
    RETURNING id
  `;
  if (!Array.isArray(rows)) return null;
  const row = rows[0] as Record<string, unknown> | undefined;
  return typeof row?.id === "string" ? row.id : null;
}

/**
 * Everywhere a pair's push should go, except the device that caused it.
 *
 * Excluding the sender is not a nicety. Without it the phone you just took a
 * photograph on buzzes in your hand to tell you that you took a photograph.
 */
export async function devicesToNotify(
  sql: QueryTag,
  pairId: string,
  exceptDeviceId: string | null,
): Promise<Device[]> {
  const rows = await sql`
    SELECT id, endpoint, p256dh, auth
    FROM pair_devices
    WHERE pair_id = ${pairId}
      AND failed_at IS NULL
      AND (${exceptDeviceId}::uuid IS NULL OR id <> ${exceptDeviceId}::uuid)
  `;
  if (!Array.isArray(rows)) return [];
  return rows.map(readDevice).filter((device): device is Device => device !== null);
}

/**
 * Marks a channel the push service has definitively refused.
 *
 * Only for 404 and 410. A timeout, a 500, or a phone that is simply switched
 * off must not retire a subscription -- that would make a week's holiday cost
 * somebody their notifications with nothing to explain why.
 */
export async function retireDevice(sql: QueryTag, deviceId: string): Promise<void> {
  await sql`UPDATE pair_devices SET failed_at = now() WHERE id = ${deviceId}`;
}

/** Forgets a device entirely, which is what "turn notifications off" does. */
export async function forgetDevice(
  sql: QueryTag,
  pairId: string,
  endpoint: string,
): Promise<boolean> {
  const rows = await sql`
    DELETE FROM pair_devices
    WHERE pair_id = ${pairId} AND endpoint = ${endpoint}
    RETURNING id
  `;
  return Array.isArray(rows) && rows.length > 0;
}
