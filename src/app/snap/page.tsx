import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { findPairByTicket } from "@/lib/pair/store";
import { TICKET_COOKIE } from "@/lib/pair/session";
import { AlbumGate } from "@/components/AlbumGate";
import { SnapCamera } from "@/components/SnapCamera";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The daily snap, on a page of its own so the home screen shortcut can open
 * straight into a camera rather than into an album with a camera somewhere in
 * it. Two taps from a locked phone to a photograph on the other side.
 */
export default async function SnapPage() {
  const store = await cookies();
  const ticket = store.get(TICKET_COOKIE)?.value ?? null;
  const pair = ticket === null ? null : await findPairByTicket(db(), ticket);

  // The camera is asked for only once there is somewhere to send the result.
  // A permission prompt in front of a person who cannot use the feature is the
  // worst possible first impression of it.
  if (pair === null) return <AlbumGate />;

  return <SnapCamera />;
}
