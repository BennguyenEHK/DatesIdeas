"use client";

import { motion, useReducedMotion } from "motion/react";
import { SaveMenu } from "./SaveMenu";
import type { KeepsakeKind } from "@/lib/photo/keepsake";

/**
 * The strip, developing beside the booth.
 *
 * It arrives rather than appearing: the live view is not cut out, so this is
 * the first time either of you sees yourselves lifted out of your own rooms
 * and put in the same place. That reveal is the point of the whole feature, so
 * it gets the one piece of motion here and nothing else does.
 *
 * Both of you built this same picture independently, from the two video feeds
 * you each already had. Nothing was sent.
 */
export function PhotoStrip({
  url,
  busy,
  onSave,
  onUpload,
  hasClip,
  clipMimeType,
  clipPending,
  onDiscard,
}: {
  /** An object URL for the finished strip, or null before there is one. */
  url: string | null;
  /** True between the last flash and the strip being ready. */
  busy: boolean;
  onSave: () => void;
  /** Uploads a keepsake and resolves the link a QR code should carry. */
  onUpload: (kind: KeepsakeKind) => Promise<{
    ok: boolean;
    url?: string;
    error?: string;
  }>;
  /** False when this sitting produced no live photo. */
  hasClip: boolean;
  /** What the browser recorded in, which decides whether a phone can keep it. */
  clipMimeType: string | null;
  /** True while the moving version is still being stitched together. */
  clipPending: boolean;
  onDiscard: () => void;
}) {
  const reduceMotion = useReducedMotion();

  if (busy) {
    return (
      <Shell>
        <p className="text-[0.7rem] uppercase tracking-[0.3em] text-[var(--lamp)]">
          Developing
        </p>
      </Shell>
    );
  }

  if (url === null) {
    return (
      <Shell>
        <p className="text-xs leading-relaxed text-[var(--mist)]">
          Pick a look, then take some photos. You&rsquo;ll both get the same strip.
        </p>
      </Shell>
    );
  }

  return (
    <motion.div
      className="flex h-full min-h-0 flex-col items-center gap-3"
      initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.7, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element --
          the source is a blob URL created in this browser a moment ago, which
          next/image cannot optimise and has no business fetching. */}
      <img
        src={url}
        alt="The photo strip you just took"
        className="min-h-0 w-auto max-w-full flex-1 rounded-[2px] object-contain shadow-[0_18px_60px_-30px_rgba(0,0,0,0.9)]"
      />
      <div className="flex shrink-0 flex-col items-center gap-3 text-xs">
        <SaveMenu
          onDownload={onSave}
          onUpload={onUpload}
          hasClip={hasClip}
          clipMimeType={clipMimeType}
          clipPending={clipPending}
        />
        <button
          type="button"
          onClick={onDiscard}
          className="rounded-[2px] px-3 py-1.5 tracking-wide text-[var(--mist)] transition-colors hover:text-[var(--cream)]"
        >
          Take another
        </button>
      </div>
    </motion.div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-24 items-center justify-center rounded-[2px] border border-dashed border-[var(--edge)] px-4 text-center">
      {children}
    </div>
  );
}
