import "server-only";

import webpush from "web-push";
import { retireDevice, type Device, type SqlTag } from "./devices";

/**
 * Sending the push itself.
 *
 * Kept apart from `devices.ts` so the data module stays a plain set of queries
 * with no network in it, and so this one can be reasoned about as "what we say
 * and what happens when it does not arrive".
 */

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/**
 * Reads VAPID configuration, or null when push is not set up.
 *
 * Absence is a normal state, the way `storageConfig()` treats a missing
 * bucket. An app without push keys still records the photograph; it just
 * cannot ring the other phone, and that must not be an exception.
 */
export function vapidConfig(): VapidConfig | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

/**
 * What the other phone is told.
 *
 * `image` is what makes this worth building: Android renders it as a big
 * picture in the shade, so you see their face without opening anything. It is
 * the closest a web app gets to the widget, and it is the reason the payload
 * carries a URL rather than a bare line of text.
 */
export interface SnapNotification {
  title: string;
  body: string;
  /** A signed, short-lived link to the poster or the photograph itself. */
  image: string | null;
  /** Where tapping it should go. */
  url: string;
  /** Collapses with any earlier unread snap, so five do not stack up. */
  tag: string;
}

interface SendOutcome {
  sent: number;
  retired: number;
}

/**
 * Pushes to every device given, and retires only the ones definitively gone.
 *
 * Failures are counted, never thrown. This runs after the response has already
 * been sent -- the photograph is saved by the time we get here -- so there is
 * nobody left to tell, and an exception would only surface as an unhandled
 * rejection in a log.
 */
export async function sendToDevices(
  sql: SqlTag,
  devices: readonly Device[],
  notification: SnapNotification,
  config: VapidConfig | null = vapidConfig(),
): Promise<SendOutcome> {
  if (config === null || devices.length === 0) return { sent: 0, retired: 0 };

  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  const payload = JSON.stringify(notification);

  let sent = 0;
  let retired = 0;

  await Promise.all(
    devices.map(async (device) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: device.endpoint,
            keys: { p256dh: device.p256dh, auth: device.auth },
          },
          payload,
          // A snap is worth nothing tomorrow. If the phone has been off for a
          // day, let the push service drop it rather than deliver yesterday.
          { TTL: SNAP_PUSH_TTL_SEC },
        );
        sent += 1;
      } catch (error: unknown) {
        const status =
          typeof error === "object" && error !== null && "statusCode" in error
            ? (error as { statusCode?: unknown }).statusCode
            : undefined;
        // 404 and 410 are the push service saying this channel no longer
        // exists. Everything else -- a timeout, a 500, a phone that is simply
        // off -- is temporary, and retiring on those would cost somebody their
        // notifications for going on holiday.
        if (status === 404 || status === 410) {
          await retireDevice(sql, device.id).catch(() => {});
          retired += 1;
        }
      }
    }),
  );

  return { sent, retired };
}

/**
 * How long a push may sit on the service waiting for a phone to come back.
 *
 * Six hours, and the picture inside it is signed for the same span. A snap is
 * a "here is my afternoon", not a document: delivering yesterday's at breakfast
 * is worse than not delivering it, and a link that outlived its notification
 * would be a picture nobody can open attached to a line of text about it.
 */
export const SNAP_PUSH_TTL_SEC = 6 * 60 * 60;
