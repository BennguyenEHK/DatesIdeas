"use client";

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { motion, useReducedMotion } from "motion/react";
import { HoldHeart } from "./HoldHeart";
import {
  canShareFiles,
  fileFromBlob,
  keepsakeFilename,
  shareFile,
} from "@/lib/photo/shareTarget";

type Stage = "idle" | "working" | "saved" | "failed";

/** The answer never changes for the life of a page, so there is nothing to
 *  subscribe to. Declared once so its identity is stable across renders. */
const subscribeNever = () => () => {};

/**
 * One keepsake, on a page of its own, with the phone's own way of keeping it.
 *
 * The QR used to point straight at the file, which meant the phone downloaded
 * it into whatever folder it downloads things into — Files on an iPhone, where
 * it is nowhere near the camera roll. A page can do better, because a page can
 * hand the file to the operating system and let it offer "Save Image" and
 * "Save Video". That sheet is the only route into Photos that exists, and it
 * is the phone's own, not something this app pretends to do.
 */
export function KeepsakeView({
  url,
  kind,
  contentType,
  room,
}: {
  /** A signed link, valid for the rest of the room's day. */
  url: string;
  kind: "strip" | "clip";
  contentType: string;
  room: string;
}) {
  const reduceMotion = useReducedMotion();
  const [stage, setStage] = useState<Stage>("idle");
  const filename = keepsakeFilename(kind, contentType, room);
  const noun = kind === "clip" ? "video" : "photo strip";

  // Declared above the callbacks that write to it.
  const primed = useRef<Promise<Blob | null> | null>(null);

  // An empty file of the right NAME and TYPE. A browser can support sharing
  // files in general and still refuse a particular type, and that has to be
  // discovered before the heart is drawn rather than after it is held.
  const probe = useMemo(
    () => new File([], filename, { type: contentType }),
    [filename, contentType],
  );

  // Read through useSyncExternalStore rather than an effect: `navigator` does
  // not exist while this renders on the server, and the server must answer
  // "no" so the markup it sends matches what the browser first draws.
  const canShare = useSyncExternalStore(
    subscribeNever,
    () => canShareFiles(undefined, probe),
    () => false,
  );

  /**
   * Starts fetching the moment the heart is pressed, not when it fills.
   *
   * The share sheet may only be opened while the browser still counts the
   * press as a live gesture, and that permission expires. Spending the hold
   * downloading means the sheet opens the instant the gold reaches the top,
   * rather than a second later with the permission gone.
   */
  const prime = useCallback(() => {
    if (primed.current !== null) return;
    primed.current = fetch(url)
      .then((r) => (r.ok ? r.blob() : null))
      .catch(() => null);
  }, [url]);

  const keep = useCallback(async () => {
    setStage("working");
    const blob = await (primed.current ?? Promise.resolve(null));
    primed.current = null;

    if (blob === null) {
      setStage("failed");
      return;
    }

    if (!canShare) {
      // No share sheet here, so hand it over as an ordinary download.
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = filename;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(href), 0);
      setStage("saved");
      return;
    }

    // No title/text alongside the file: iOS is more likely to rank
    // "Save to Photos"/"Save Video" first in the sheet when the payload is
    // file-only, rather than burying it behind a mixed text+file share.
    const outcome = await shareFile(fileFromBlob(blob, filename, contentType));
    // Cancelling the sheet is a decision, not a fault, so it goes quietly back
    // to the start rather than showing anyone an error.
    setStage(
      outcome === "shared" ? "saved" : outcome === "dismissed" ? "idle" : "failed",
    );
  }, [canShare, filename, contentType]);

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-7">
      <motion.div
        className="w-full overflow-hidden rounded-[2px] ring-1 ring-[var(--edge)]"
        initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.6, ease: [0.22, 1, 0.36, 1] }}
      >
        {kind === "clip" ? (
          <video src={url} controls playsInline loop className="h-auto w-full" />
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element --
             a signed, short-lived link to a bucket next/image cannot optimise.
             It is also deliberately a real <img>: on an iPhone, long-pressing
             one already offers "Add to Photos" with no code at all, which is a
             second route to the camera roll for anyone who never finds the
             heart. */
          <img src={url} alt="Your photo strip" className="h-auto w-full" />
        )}
      </motion.div>

      <HoldHeart
        onPrime={prime}
        onComplete={() => void keep()}
        busy={stage === "working"}
        label={
          canShare
            ? `Hold to save this ${noun} to your photos`
            : `Hold to download this ${noun}`
        }
        hint={
          stage === "saved"
            ? canShare
              ? "Saved"
              : "Download succeeded"
            : stage === "failed"
              ? "That didn’t save — the link may have closed with the room"
              : canShare
                ? "Hold the heart until it fills"
                : "Hold to fill, for download"
        }
      />

      <p className="max-w-xs text-center text-[0.65rem] leading-relaxed text-[var(--mist)]">
        {canShare
          ? "Your phone will ask where to keep it. Choose Save Image or Save Video and it goes straight to your photos."
          : "This link stops working when the room does."}
      </p>
    </div>
  );
}
