"use client";

import Link from "next/link";
import { LookbookStage } from "@/components/lookbook/LookbookStage";
import type { LookbookView } from "@/lib/lookbook/contract";
import type { Outfit } from "@/lib/lookbook/types";

interface RoomLookbookProps {
  view: LookbookView;
  onKeepInAlbum: (outfit: Outfit, png: Blob) => Promise<boolean>;
  onClose: () => void;
  /** True while this device is being let into the album from the other screen. */
  joining?: boolean;
  /** Why joining the album from the other screen failed, or null. */
  joinError?: string | null;
  onRetryJoin?: () => void;
  /** False when neither device holds a ticket, so there is nobody to ask. */
  canBeInvited?: boolean;
}

/**
 * The Lookbook, open in the call.
 *
 * Its wardrobe and outfits are kept across evenings, so like the album and
 * the calendar it lives behind the season ticket: a device without one is
 * told how to join -- in the calendar's words, since it is the same ticket --
 * rather than shown an empty wardrobe that would silently save nothing.
 */
export function RoomLookbook({
  view,
  onKeepInAlbum,
  onClose,
  joining = false,
  joinError = null,
  onRetryJoin,
  canBeInvited,
}: RoomLookbookProps) {
  if (view.status === "unpaired" && joining) {
    return (
      <section
        className="flex h-full min-h-0 flex-col items-center justify-center bg-[var(--letterbox)]
          px-5 text-center"
      >
        <p role="status" className="font-sans text-sm text-[var(--mist)]">
          Getting you in…
        </p>
      </section>
    );
  }

  if (view.status === "unpaired" && joinError !== null) {
    return (
      <section
        className="flex h-full min-h-0 flex-col items-center justify-center bg-[var(--letterbox)]
          px-5 text-center"
      >
        <div className="max-w-sm border-y border-[var(--edge)] py-6">
          <p className="font-sans text-sm text-[var(--mist)]">{joinError}</p>
          <div className="mt-5 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={onRetryJoin}
              className="border border-[var(--lamp)] px-3 py-2 font-sans text-xs text-[var(--lamp)]"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={onClose}
              className="border border-[var(--edge)] px-3 py-2 font-sans text-xs text-[var(--mist)]"
            >
              Back to the call
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (view.status === "unpaired") {
    return (
      <section
        className="flex h-full min-h-0 flex-col items-center justify-center bg-[var(--letterbox)]
          px-5 text-center"
      >
        <div className="max-w-sm border-y border-[var(--edge)] py-6">
          <p className="font-display text-xl text-[var(--cream)]">
            This device isn&apos;t on your lookbook yet.
          </p>
          {canBeInvited === false ? (
            <Link
              href="/us/new"
              className="mt-3 inline-block font-sans text-xs text-[var(--lamp)] underline
                underline-offset-4"
            >
              Set up your album
            </Link>
          ) : (
            <p className="mt-2 font-sans text-xs leading-5 text-[var(--mist)]">
              Open the album on the other device and scan the season ticket QR.
            </p>
          )}
          <button
            type="button"
            onClick={onClose}
            className="mx-auto mt-5 block border border-[var(--lamp)] px-3 py-2 font-sans text-xs
              text-[var(--lamp)]"
          >
            Back to the call
          </button>
        </div>
      </section>
    );
  }

  return <LookbookStage view={view} onKeepInAlbum={onKeepInAlbum} />;
}
