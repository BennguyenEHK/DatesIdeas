"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { HoldHeart } from "./HoldHeart";
import { qrDataUrl, QR_SIZE } from "@/lib/photo/qr";
import { phoneCanKeep } from "@/lib/photo/record";
import type { KeepsakeKind } from "@/lib/photo/keepsake";

/** Which way of taking the strip away is open. */
export type SaveMode = "local" | "picture" | "video";

interface Choice {
  mode: SaveMode;
  label: string;
  note: string;
}

/**
 * Three ways to take a strip away, and they are genuinely different things
 * rather than three buttons doing one job.
 *
 * Download keeps the booth's original promise: the picture was built in this
 * browser and never leaves it. Both QR modes break that promise on purpose —
 * a QR code holds a few kilobytes of text, nowhere near a photograph, so the
 * only thing it can carry is a LINK, and a link needs the file to exist
 * somewhere a phone can reach. That is worth saying out loud in the menu
 * rather than discovering afterwards.
 */
const CHOICES: readonly Choice[] = [
  { mode: "local", label: "Save to this computer", note: "Stays here. Nothing is uploaded." },
  { mode: "picture", label: "QR — photo strip", note: "Uploads the strip so a phone can scan it." },
  { mode: "video", label: "QR — live strip", note: "The moving version. Bigger, slower to send." },
];

/**
 * What to say under a choice, given what this sitting actually produced.
 *
 * The live-strip line is the one that changes, and it changes because a QR is a
 * promise: somebody walks over to a phone and scans it. Finding out there that
 * the video will not go into their photos is finding out too late, so the menu
 * says it while the choice is still being made.
 */
function noteFor(
  choice: Choice,
  state: { hasClip: boolean; clipPending: boolean; clipTravels: boolean },
): string {
  if (choice.mode !== "video") return choice.note;
  if (!state.hasClip) return "No live photo from this sitting.";
  if (state.clipPending) return "Still stitching the moving version…";
  if (!state.clipTravels) {
    return "This browser recorded WebM — it plays on a computer, but a phone’s photos won’t take it.";
  }
  return choice.note;
}

export function SaveMenu({
  onDownload,
  onUpload,
  hasClip,
  clipMimeType,
  clipPending,
}: {
  onDownload: () => void;
  /** Uploads and resolves the link a QR should carry, or an error. */
  onUpload: (kind: KeepsakeKind) => Promise<{ ok: boolean; url?: string; error?: string }>;
  /** False when this sitting produced no live photo to offer. */
  hasClip: boolean;
  /** What the browser recorded in, which decides whether a phone can keep it. */
  clipMimeType: string | null;
  /** True while the live strip is still being stitched together. */
  clipPending: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<SaveMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // Clicking anywhere else closes the list, which is what every menu on every
  // machine already does and therefore what hands expect without being told.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const choose = useCallback(
    async (next: SaveMode) => {
      setOpen(false);
      setError(null);
      setQr(null);
      setLink(null);
      setMode(next);
      if (next === "local") return;

      setBusy(true);
      const result = await onUpload(next === "picture" ? "strip" : "clip");
      if (!result.ok || result.url === undefined) {
        setError(result.error ?? "that did not send");
        setBusy(false);
        return;
      }
      setLink(result.url);
      setQr(await qrDataUrl(result.url));
      setBusy(false);
    },
    [onUpload],
  );

  const current = CHOICES.find((c) => c.mode === mode) ?? null;

  return (
    <div ref={box} className="relative flex flex-col items-center gap-3">
      <div className="flex items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="menu"
          className="flex items-center gap-2 rounded-[2px] bg-[var(--dress)] px-4 py-1.5 font-medium tracking-wide text-[#1a1405] transition-colors hover:bg-[var(--lamp)]"
        >
          {current === null ? "Save" : current.label}
          <span aria-hidden className="text-[0.6rem]">
            ▾
          </span>
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label="How to save this strip"
            className="absolute bottom-full z-20 mb-2 w-64 overflow-hidden rounded-[2px] border border-[var(--edge)] bg-[var(--letterbox)] shadow-[0_18px_60px_-24px_rgba(0,0,0,0.9)]"
            initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
            transition={{ duration: reduceMotion ? 0 : 0.16, ease: "easeOut" }}
          >
            {CHOICES.map((choice) => {
              const unavailable = choice.mode === "video" && !hasClip;
              // A WebM live strip stays offered rather than disabled: it is a
              // real file that plays perfectly on the computer it was made on.
              // Only the phone cannot keep it, and that is what the note says.
              return (
                <button
                  key={choice.mode}
                  type="button"
                  role="menuitem"
                  disabled={unavailable || (choice.mode === "video" && clipPending)}
                  onClick={() => void choose(choice.mode)}
                  className="block w-full border-b border-[var(--edge)] px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-[var(--lamp)]/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <span className="block text-xs text-[var(--cream)]">
                    {choice.label}
                  </span>
                  <span className="block text-[0.65rem] leading-snug text-[var(--mist)]">
                    {noteFor(choice, {
                      hasClip,
                      clipPending,
                      clipTravels: phoneCanKeep(clipMimeType),
                    })}
                  </span>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {mode === "local" && (
        <HoldHeart
          onComplete={onDownload}
          label="Hold to save the strip to this computer"
          hint="Hold the heart until it fills"
        />
      )}

      {(mode === "picture" || mode === "video") && (
        <QrCard busy={busy} qr={qr} link={link} error={error} />
      )}
    </div>
  );
}

/** The code itself, once there is a link for it to carry. */
function QrCard({
  busy,
  qr,
  link,
  error,
}: {
  busy: boolean;
  qr: string | null;
  link: string | null;
  error: string | null;
}) {
  if (busy) {
    return (
      <p className="text-[0.7rem] uppercase tracking-[0.3em] text-[var(--lamp)]">
        Sending
      </p>
    );
  }

  if (error !== null) {
    return (
      <p className="max-w-56 text-center text-[0.65rem] leading-relaxed text-[var(--neon)]">
        {error}
      </p>
    );
  }

  if (qr === null) return null;

  return (
    <div className="flex flex-col items-center gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element --
          a data URL generated in this browser a moment ago, which next/image
          cannot optimise and has no business fetching. */}
      <img
        src={qr}
        alt={link === null ? "QR code" : `QR code linking to ${link}`}
        width={QR_SIZE}
        height={QR_SIZE}
        className="rounded-[2px]"
      />
      <p className="max-w-56 text-center text-[0.6rem] leading-relaxed text-[var(--mist)]">
        Point a phone camera at this. The link stops working when the room does.
      </p>
    </div>
  );
}
