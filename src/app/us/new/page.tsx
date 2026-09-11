"use client";

import { useState } from "react";
import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";
import { TicketQR } from "@/components/TicketQR";

/**
 * Starting an album, which happens exactly once for a couple.
 *
 * A static segment, so it wins over `/us/[ticket]` and a 22-character secret
 * can never collide with it.
 *
 * Behind a button rather than performed on arrival, and that is not
 * ceremony. A GET that creates a pair would make one every time the page was
 * prefetched, opened twice, or crawled -- and a stray second album is the one
 * mistake in this flow that cannot be undone by pressing something else,
 * because the ticket to the first one is in a cookie this page just replaced.
 */
export default function NewPairPage() {
  const [ticketUrl, setTicketUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/pair", {
        method: "POST",
        credentials: "same-origin",
      });
      if (response.status === 409) {
        // The server refused because this browser already holds a ticket.
        // Say which album it means and point at it, rather than reporting a
        // failure -- nothing failed, and the album they want is one tap away.
        setError("already");
        return;
      }
      if (!response.ok) {
        setError("The album could not be started just now.");
        return;
      }
      const body = (await response.json()) as { ticket?: string };
      if (typeof body.ticket !== "string") {
        setError("The album started but the ticket did not come back.");
        return;
      }
      setTicketUrl(new URL(`/us/${body.ticket}`, window.location.origin).toString());
    } catch {
      setError("The album could not be reached.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-[var(--letterbox)] px-5 py-10">
      <Wordmark size="compact" />

      {ticketUrl === null ? (
        <div className="max-w-sm text-center">
          <h1 className="font-display text-2xl text-[var(--cream)]">
            Start an album
          </h1>
          <p className="mt-4 font-sans text-sm leading-relaxed text-[var(--mist)]">
            One permanent link between the two of you. No email, no password,
            nothing to sign up for — the link is the whole thing, so keep it the
            way you would keep a key.
          </p>
          <p className="mt-3 font-sans text-sm leading-relaxed text-[var(--mist)]">
            Do this once. If you already have an album, open its link instead —
            starting a second one here would leave the first behind.
          </p>
          <button
            type="button"
            onClick={() => void start()}
            disabled={pending}
            className="mt-7 inline-flex items-center rounded-full bg-[var(--lamp)]/15 px-5 py-2.5 font-sans text-sm tracking-wide text-[var(--cream)] ring-1 ring-[var(--lamp)]/60 transition-colors hover:bg-[var(--lamp)]/25 disabled:opacity-50"
          >
            {pending ? "Starting…" : "Start our album"}
          </button>
          {error === "already" ? (
            <p className="mt-4 font-sans text-xs leading-relaxed text-[var(--mist)]">
              This browser already has an album.{" "}
              <Link
                href="/album"
                className="text-[var(--lamp)] underline decoration-[var(--lamp)]/40 underline-offset-4"
              >
                Open it
              </Link>{" "}
              rather than starting another — a second one would leave the first
              behind.
            </p>
          ) : error !== null ? (
            <p className="mt-4 font-sans text-xs text-[var(--neon)]">{error}</p>
          ) : null}
        </div>
      ) : (
        <div className="flex max-w-sm flex-col items-center gap-6 text-center">
          <div>
            <h1 className="font-display text-2xl text-[var(--cream)]">
              This browser is remembered
            </h1>
            <p className="mt-4 font-sans text-sm leading-relaxed text-[var(--mist)]">
              Scan this on K&rsquo;s phone to put the album there too. You can
              bring it up again any time from the album.
            </p>
          </div>
          <TicketQR url={ticketUrl} autoShow />
          <Link
            href="/album"
            className="font-sans text-sm tracking-wide text-[var(--lamp)] underline decoration-[var(--lamp)]/40 underline-offset-4"
          >
            Open the album
          </Link>
        </div>
      )}
    </main>
  );
}
