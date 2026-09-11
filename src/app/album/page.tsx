import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { findPairByTicket } from "@/lib/pair/store";
import { TICKET_COOKIE } from "@/lib/pair/session";
import { AlbumGate } from "@/components/AlbumGate";
import { AlbumClient } from "@/components/AlbumClient";

export const runtime = "nodejs";
/**
 * Never cached. Every visit re-signs the storage links the album draws with,
 * and a cached render would hand out a set that expired hours ago -- the same
 * reason `k/[id]/page.tsx` is dynamic.
 */
export const dynamic = "force-dynamic";

/**
 * The album.
 *
 * This component decides one thing only: whether this browser is holding a
 * season ticket. Everything else -- what is in the album, how it is grouped,
 * what timezone to group it in -- belongs to the client, because the answer to
 * the last of those lives in the browser and nowhere else.
 */
export default async function AlbumPage() {
  const store = await cookies();
  const ticket = store.get(TICKET_COOKIE)?.value ?? null;
  const pair = ticket === null ? null : await findPairByTicket(db(), ticket);

  if (pair === null) return <AlbumGate />;

  return <AlbumClient />;
}
