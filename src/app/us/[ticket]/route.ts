import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ticketCookie } from "@/lib/pair/session";
import { findPairByTicket } from "@/lib/pair/store";
import { isTicket } from "@/lib/pair/ticket";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ ticket: string }> }) {
  const { ticket } = await params;
  const response = NextResponse.redirect(new URL("/album", request.url), 302);
  if (!isTicket(ticket)) return response;
  const pair = await findPairByTicket(db(), ticket);
  if (pair !== null) response.cookies.set(ticketCookie(ticket));
  return response;
}
