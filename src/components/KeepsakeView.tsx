"use client";

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { motion, useReducedMotion } from "motion/react";
import { HoldHeart } from "./HoldHeart";
import { phoneCanKeep } from "@/lib/photo/record";
import {
  canShareFiles,
  downloadBlob,
  fileFromBlob,
  isApplePhotosDevice,
  keepsakeFilename,
  saveRoute,
  shareFile,
  type SaveRoute,
} from "@/lib/photo/shareTarget";

type Stage = "idle" | "working" | "saved" | "failed";

/** The answer never changes for the life of a page, so there is nothing to
 *  subscribe to. Declared once so its identity is stable across renders. */
const subscribeNever = () => () => {};

/**
 * One keepsake, on a page of its own, and the shortest honest route from here
 * into the person's own photos.
 *
 * There are two such routes and they belong to different platforms, which is
 * why this does not simply always open the share sheet. On an iPhone the sheet
 * is the only way into Photos at all — a download there lands in Files, which
 * is nowhere near the camera roll. Everywhere else the sheet is a chooser
 * standing in front of a file somebody already asked for, and an ordinary
 * download is both quicker and better: Android's media scanner picks a
 * downloaded image or video up and it appears in the gallery by itself.
 *
 * Neither route trusts the storage link to name the file. That bucket discards
 * `response-content-disposition` on a signed URL, so the browser was left
 * inventing a name — which is how a photo strip arrived saved as something that
 * was not a .png, and how a phone came to treat a photograph as anonymous data.
 * The bytes are fetched here and the name is decided here.
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
  // not exist while this renders on the server, so the server answers with the
  // route that needs nothing from the browser, and the markup it sends matches
  // what the browser first draws.
  const route = useSyncExternalStore(
    subscribeNever,
    () => saveRoute(canShareFiles(undefined, probe)),
    (): SaveRoute => "download",
  );

  // Long-press-to-save is a genuinely chooser-free route, but it is an iOS
  // Safari context-menu behaviour, not something this code can offer anywhere
  // else — so the tip only appears where it will actually work.
  const isApple = useSyncExternalStore(
    subscribeNever,
    () => isApplePhotosDevice(),
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

    // Retyped from what we KNOW this keepsake is rather than from what the
    // response happened to say. Both an operating system's "can I save this?"
    // and a share sheet's ranking are decided from the type and the extension
    // together, so neither is left to chance.
    const typed =
      blob.type === contentType ? blob : new Blob([blob], { type: contentType });

    if (route === "download") {
      setStage(downloadBlob(typed, filename) ? "saved" : "failed");
      return;
    }

    // No title/text alongside the file: iOS is more likely to rank
    // "Save to Photos"/"Save Video" first in the sheet when the payload is
    // file-only, rather than burying it behind a mixed text+file share.
    const outcome = await shareFile(fileFromBlob(typed, filename, contentType));
    // Cancelling the sheet is a decision, not a fault, so it goes quietly back
    // to the start rather than showing anyone an error.
    setStage(
      outcome === "shared" ? "saved" : outcome === "dismissed" ? "idle" : "failed",
    );
  }, [route, filename, contentType]);

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
        label={`Hold to download this ${noun}`}
        hint={
          stage === "saved"
            ? route === "share"
              ? "Kept"
              : "Downloaded"
            : stage === "failed"
              ? "That didn’t save — the link may have closed with the room"
              : "Hold to fill, for download"
        }
      />

      <p className="max-w-xs text-center text-[0.65rem] leading-relaxed text-[var(--mist)]">
        {route === "share"
          ? `Your phone will ask where to keep it. Choose Save ${
              kind === "clip" ? "Video" : "Image"
            } and it goes straight to your photos.`
          : `It downloads straight to this device — no menu. On a phone your gallery picks the ${noun} up from there.`}
      </p>

      {isApple && kind === "strip" && (
        <p className="max-w-xs text-center text-[0.65rem] leading-relaxed text-[var(--mist)]">
          Tip: press and hold the photo above to save it directly — no menu.
        </p>
      )}

      {/* Said plainly rather than discovered afterwards: this browser recorded
          a format Photos will not take, and no amount of holding will change
          that. The clip still plays, and it still saves — just to Files. */}
      {kind === "clip" && !phoneCanKeep(contentType) && (
        <p className="max-w-xs text-center text-[0.65rem] leading-relaxed text-[var(--neon)]">
          This one was recorded as WebM, which a phone’s photo library won’t
          accept. It will save to your files instead. Recording again on a
          different browser gives you an MP4, which Photos does take.
        </p>
      )}
    </div>
  );
}
