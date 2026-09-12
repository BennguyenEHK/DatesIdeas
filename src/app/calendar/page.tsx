import { cookies } from "next/headers";
import { AlbumGate } from "@/components/AlbumGate";
import { CalendarClient } from "@/components/CalendarClient";
import { db } from "@/lib/db";
import { findPairByTicket } from "@/lib/pair/store";
import { TICKET_COOKIE } from "@/lib/pair/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const store = await cookies();
  const ticket = store.get(TICKET_COOKIE)?.value ?? null;
  const pair = ticket === null ? null : await findPairByTicket(db(), ticket);
  if (pair === null) return <AlbumGate />;
  return <CalendarClient />;
}
