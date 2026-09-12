import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { claimReminder, reminderCandidates } from "@/lib/calendar/blocks";
import { dueOccurrence, reminderBody } from "@/lib/calendar/remind";
import { devicesToNotify } from "@/lib/push/devices";
import { sendToDevices } from "@/lib/push/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function queryTag() {
  const client = db();
  return async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<Record<string, unknown>[]> => {
    const rows: unknown = await client(strings, ...values);
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  };
}

/**
 * Whether the caller holds the cron secret.
 *
 * Vercel sends `Authorization: Bearer <CRON_SECRET>` on its own when that
 * variable is set. Compared in constant time, with both sides padded to one
 * length first, the same way the helper route guards its token.
 */
function authorised(request: Request, secret: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const length = Math.max(supplied.length, secret.length, 1);
  const expected = Buffer.from(secret.padEnd(length, "\0"));
  const given = Buffer.from(supplied.padEnd(length, "\0"));
  return timingSafeEqual(expected, given) && supplied.length === secret.length;
}

/**
 * The reminder sweep.
 *
 * Correct at any frequency: every five minutes on a paid plan, once a day on
 * Vercel's free one, or whenever an outside pinger calls it. Due-ness and
 * de-duplication live in remind.ts and in an atomic claim, so running it twice
 * in a row sends nothing the second time, and two overlapping runs never send
 * the same reminder twice.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  // Refuse rather than run open. An unset secret must never mean "anyone may
  // trigger a push to every couple".
  if (!secret) {
    return NextResponse.json({ error: "reminders are not set up for this app yet" }, { status: 503 });
  }
  if (!authorised(request, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sql = queryTag();
  const now = new Date();
  const candidates = await reminderCandidates(sql, now);

  let sent = 0;
  let due = 0;

  for (const block of candidates) {
    const occurrence = dueOccurrence(block, now);
    if (occurrence === null) continue;
    due += 1;

    // Claim first, send second. If another run already claimed it, stop here.
    const claimed = await claimReminder(sql, block.id, occurrence);
    if (!claimed) continue;

    const devices = await devicesToNotify(sql, block.pairId, null);
    const outcome = await sendToDevices(sql, devices, {
      title: block.title,
      body: reminderBody(block.remindMinutes),
      image: null,
      url: "/calendar",
      // One tag per block, so a reminder replaces rather than stacks on an
      // unread earlier one for the same thing.
      tag: `festibooth-reminder-${block.id}`,
    });
    sent += outcome.sent;
  }

  return NextResponse.json({ checked: candidates.length, due, sent });
}
