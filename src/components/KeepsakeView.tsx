"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  canShareFiles,
  fileFromBlob,
  keepsakeFilename,
  shareFile,
} from "@/lib/photo/shareTarget";

type Stage = "idle" | "fetching" | "sharing" | "saved" | "failed";

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
 *
 * The plain download stays underneath for anything that cannot share files,
 * which is most desktop browsers.
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

  // An empty file of the right NAME and TYPE. A browser can support sharing
  // files in general and still refuse a particular type, and that has to be
  // discovered before the button is drawn rather than after it is pressed.
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

  const save = useCallback(async () => {
    setStage("fetching");
    try {
      // The bytes have to be in hand before the sheet opens: the share sheet
      // takes a file, not a link, and asking for one mid-gesture is what makes
      // the button feel instant afterwards.
      const blob = await fetch(url).then((r) => (r.ok ? r.blob() : null));
      if (blob === null) {
        setStage("failed");
        return;
      }
      setStage("sharing");
      const outcome = await shareFile(fileFromBlob(blob, filename, contentType), {
        title: "FestiBooth",
      });
      // Cancelling the sheet is a decision, not a fault, so it goes quietly
      // back to the start rather than showing anyone an error.
      setStage(
        outcome === "shared" ? "saved" : outcome === "dismissed" ? "idle" : "failed",
      );
    } catch {
      setStage("failed");
    }
  }, [url, filename, contentType]);

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-5">
      <motion.div
        className="w-full overflow-hidden rounded-[2px] ring-1 ring-[var(--edge)]"
        initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.6, ease: [0.22, 1, 0.36, 1] }}
      >
        {kind === "clip" ? (
          <video
            src={url}
            controls
            playsInline
            loop
            className="h-auto w-full"
          />
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element --
             a signed, short-lived link to a bucket next/image cannot optimise.
             It is also deliberately a real <img>: on an iPhone, long-pressing
             one already offers "Add to Photos" with no code at all, which is a
             second route to the camera roll for anyone who never finds the
             button. */
          <img
            src={url}
            alt="Your photo strip"
            className="h-auto w-full"
          />
        )}
      </motion.div>

      {canShare ? (
        <button
          type="button"
          onClick={() => void save()}
          disabled={stage === "fetching" || stage === "sharing"}
          className="w-full rounded-[2px] bg-[var(--dress)] px-6 py-3 text-sm font-medium tracking-wide text-[#1a1405] transition-colors hover:bg-[var(--lamp)] disabled:bg-[var(--mist)]/25 disabled:text-[var(--mist)]"
        >
          {stage === "fetching"
            ? "Getting it…"
            : stage === "sharing"
              ? "Choose “Save”…"
              : stage === "saved"
                ? "Saved"
                : "Save to Photos"}
        </button>
      ) : null}

      {/* Always present, and the only thing on offer where files cannot be
          shared. `download` names the file rather than letting the browser
          invent one from the URL. */}
      <a
        href={url}
        download={filename}
        className="text-xs tracking-wide text-[var(--mist)] underline decoration-dotted underline-offset-4 transition-colors hover:text-[var(--cream)]"
      >
        {canShare ? "or download the file" : "Download"}
      </a>

      {stage === "failed" && (
        <p className="text-center text-xs leading-relaxed text-[var(--neon)]">
          That didn&rsquo;t save. The link may have expired with the room —
          try taking a fresh photo strip.
        </p>
      )}

      <p className="max-w-xs text-center text-[0.65rem] leading-relaxed text-[var(--mist)]">
        {canShare
          ? "Your phone will ask where to keep it. Choose Save Image or Save Video and it goes straight to your photos."
          : "This link stops working when the room does."}
      </p>
    </div>
  );
}
