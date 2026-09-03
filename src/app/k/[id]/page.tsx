import Link from "next/link";
import { db } from "@/lib/db";
import { findKeepsake } from "@/lib/keepsakes/store";
import { presignKeepsake } from "@/lib/storage/objects";
import { KeepsakeView } from "@/components/KeepsakeView";
import { Wordmark } from "@/components/Wordmark";

export const runtime = "nodejs";
// Every visit mints a fresh signed link, so nothing about this page may be
// cached: a cached one would hand out a link that has already expired.
export const dynamic = "force-dynamic";

/**
 * One keepsake, reachable by the short code in a QR.
 *
 * The signed link is made HERE, at the moment someone opens the page, rather
 * than baked into the code when the photograph was taken. A QR printed at nine
 * in the evening and scanned at midnight would otherwise carry a link that had
 * quietly expired in between.
 */
export default async function KeepsakePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const keepsake = await findKeepsake(db(), id);

  // One message for every way of not finding it: wrong code, expired room,
  // never existed. Being more specific would tell a stranger holding a guessed
  // code which of their guesses was closest.
  if (keepsake === null) return <Gone />;

  const signed = await presignKeepsake(keepsake.objectKey, keepsake.contentType);
  if (signed === null) return <Gone />;

  return (
    <Shell>
      <KeepsakeView
        url={signed.downloadUrl}
        kind={keepsake.kind}
        contentType={keepsake.contentType}
        room={keepsake.roomCode}
      />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-[var(--letterbox)] px-5 py-10">
      <Wordmark size="compact" />
      {children}
    </main>
  );
}

function Gone() {
  return (
    <Shell>
      <div className="max-w-xs text-center">
        <p className="text-sm leading-relaxed text-[var(--cream)]">
          This keepsake has gone.
        </p>
        <p className="mt-3 text-xs leading-relaxed text-[var(--mist)]">
          A photo strip lives as long as the evening that made it — one day.
          After that the link closes, which is rather the point.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block text-xs tracking-wide text-[var(--lamp)] underline decoration-[var(--lamp)]/40 underline-offset-4"
        >
          Start a new room
        </Link>
      </div>
    </Shell>
  );
}
