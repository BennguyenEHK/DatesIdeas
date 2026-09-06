"use client";

import { useEffect } from "react";

/**
 * What is shown when something in the room throws.
 *
 * Without this file a thrown render error unmounts the tree and leaves a blank
 * page. In development Next puts an overlay over that; in production it does
 * not, so the only symptom is the room vanishing -- which is indistinguishable
 * from a crashed tab, a dropped connection, or an expired room, and says
 * nothing about which of them it was.
 *
 * So this is a diagnostic before it is a courtesy. It puts the message and the
 * digest on screen where they can be read out, and keeps the room recoverable
 * without a reload, which matters when the other person is still on the call.
 */
export default function RoomError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    // Also to the console, because the stack is there and not here.
    console.error("Room crashed:", error);
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-[var(--letterbox)] px-6 text-center">
      <p className="text-[0.65rem] tracking-[0.4em] text-[var(--lamp)]">
        THE ROOM STOPPED
      </p>

      <p className="max-w-md text-sm leading-relaxed text-[var(--cream)]">
        Something in the room threw an error, so the page stopped rather than
        showing you something wrong.
      </p>

      {/* The actual reason, verbatim. A paraphrase here would cost the one
          thing this screen exists to provide. */}
      <pre className="max-w-full overflow-x-auto rounded-[2px] border border-[var(--edge)] bg-[rgba(8,11,28,0.6)] px-4 py-3 text-left text-[0.7rem] text-[var(--mist)]">
        {error.message || "No message was attached to the error."}
        {error.digest ? `\n\ndigest: ${error.digest}` : ""}
      </pre>

      <button
        type="button"
        onClick={retry}
        className="rounded-[2px] border border-[var(--lamp)]/45 px-5 py-2 text-xs tracking-wide text-[var(--lamp)] transition-colors hover:bg-[var(--lamp)]/10"
      >
        Try the room again
      </button>

      <p className="text-[0.65rem] text-[var(--mist)]">
        The room itself is still open — this only stopped the page.
      </p>
    </main>
  );
}
