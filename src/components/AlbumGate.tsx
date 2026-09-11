import Link from "next/link";
import { Wordmark } from "./Wordmark";

/**
 * What an unpaired device sees at /album.
 *
 * Not a 404 and not an error. There is nothing wrong with this browser -- it
 * simply has not been handed the ticket yet, which is the ordinary state of a
 * new phone. The screen's whole job is to say what the next action is and who
 * can perform it.
 *
 * It deliberately does not offer to create a pair from here. A second pair
 * made by accident, on a phone that already had a perfectly good album
 * elsewhere, is the one mistake in this flow that cannot be undone by pressing
 * something else -- so making one is kept on its own page, reached on purpose.
 */
export function AlbumGate() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-[var(--letterbox)] px-5 py-10">
      <Wordmark size="compact" />
      <div className="max-w-sm text-center">
        <h1 className="font-display text-2xl text-[var(--cream)]">
          This device has no season ticket
        </h1>
        <p className="mt-4 font-sans text-sm leading-relaxed text-[var(--mist)]">
          The album opens with one permanent link that lives on each of your
          devices. Open that link here once and this browser is remembered — no
          password, nothing to sign up for.
        </p>
        <p className="mt-4 font-sans text-sm leading-relaxed text-[var(--mist)]">
          On a device that already has it, open the album and choose{" "}
          <span className="text-[var(--cream)]">Show the ticket</span> to scan it
          across.
        </p>
        <Link
          href="/us/new"
          className="mt-7 inline-block font-sans text-xs tracking-wide text-[var(--lamp)] underline decoration-[var(--lamp)]/40 underline-offset-4"
        >
          Neither of us has one yet — start an album
        </Link>
      </div>
    </main>
  );
}
