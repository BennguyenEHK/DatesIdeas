"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChatBox } from "./ChatBox";
import type { ChatLine } from "@/lib/ui/chatLog";

/** How long an unread line hangs above the bulb before it withdraws. */
export const TOAST_MS = 6000;

/**
 * The chat, kept out of the way until it is wanted.
 *
 * A film is the point of the evening and a panel that sits open all night is a
 * panel that spends most of the night empty, taking room from the thing people
 * came for. So this is a bulb in the corner of the letterbox bar: dark when
 * there is nothing to say, lit when there is, and a whole conversation only
 * when someone asks for one.
 *
 * The bulb is deliberately the same object as the ones in the activity bar --
 * a round marquee lamp with a soft bloom behind it -- because it does the same
 * job there: something is on, and here is where. Inventing a second idiom for
 * the same idea is how an interface stops feeling like one place.
 *
 * An arriving line shows itself once, briefly, above the bulb. That is the part
 * worth getting right: being told a thing was said should not mean having the
 * film covered by a panel you did not open.
 */
export function ChatBubble({
  lines,
  onSend,
  ready,
}: {
  lines: readonly ChatLine[];
  onSend: (text: string) => void;
  ready: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [toast, setToast] = useState<ChatLine | null>(null);
  const reduceMotion = useReducedMotion();

  // What had already arrived last time this looked. A count rather than the
  // list itself: only growth matters, and only growth from their end.
  const seen = useRef(lines.length);

  useEffect(() => {
    if (lines.length <= seen.current) {
      // The log can shrink as old lines are dropped; follow it down rather than
      // leaving a high-water mark that suppresses the next real arrival.
      seen.current = lines.length;
      return;
    }
    const arrived = lines.slice(seen.current);
    seen.current = lines.length;

    const theirs = arrived.filter((line) => !line.mine);
    if (theirs.length === 0) return;

    // Your own words are not news to you, and an open panel is already showing
    // them -- in both cases there is nothing here to announce.
    if (open) return;
    setUnread((count) => count + theirs.length);
    setToast(theirs[theirs.length - 1]);
  }, [lines, open]);

  useEffect(() => {
    if (toast === null) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const openPanel = () => {
    setOpen(true);
    setUnread(0);
    setToast(null);
  };

  const lit = unread > 0;

  return (
    /* Anchored to the bar's own box rather than to the viewport, and stretched
       across it, so every child can be capped with max-w-full. The old version
       sized itself with calc(100vw - 2rem), and 100vw INCLUDES the vertical
       scrollbar, so on a scrolling page the panel was wider than the room it
       actually had.

       Held 40px clear of the right-hand edge rather than flush against it, and
       that inset is load-bearing rather than taste. The bulb's bloom is drawn
       at inset-[-7px] -- deliberately OUTSIDE the button, which is what makes
       it read as light rather than as a border -- so a bulb sitting flush at
       right-0 spills its glow past the viewport and the browser grows the
       document sideways to contain it. The scrollbar was the glow, not the
       panel. */
    <div className="pointer-events-none absolute bottom-full left-0 right-10 z-30 mb-4 flex flex-col items-end gap-2">
      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            className="pointer-events-auto w-[26rem] max-w-full"
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
            transition={{ duration: reduceMotion ? 0 : 0.22, ease: "easeOut" }}
          >
            <ChatBox lines={lines} onSend={onSend} ready={ready} />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {!open && toast !== null && (
          <motion.p
            key={toast.id}
            role="status"
            className="pointer-events-none max-w-full truncate rounded-[6px] border-l-2 border-[var(--lamp)]/60 bg-[rgba(8,11,28,0.92)] px-3 py-1.5 text-xs text-[var(--cream)] shadow-[0_10px_30px_-18px_rgba(0,0,0,0.9)]"
            initial={reduceMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.25, ease: "easeOut" }}
          >
            {toast.text}
          </motion.p>
        )}
      </AnimatePresence>

      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openPanel())}
        aria-expanded={open}
        aria-label={
          open
            ? "Close chat"
            : unread > 0
              ? `Open chat, ${unread} new ${unread === 1 ? "message" : "messages"}`
              : "Open chat"
        }
        className={`pointer-events-auto relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full ring-1 transition-colors duration-300 ${
          lit || open
            ? "bg-[var(--lamp)]/20 text-[var(--cream)] ring-[var(--lamp)]/80"
            : "bg-[rgba(8,11,28,0.85)] text-[var(--mist)] ring-[var(--edge)] hover:bg-[var(--lamp)]/10 hover:text-[var(--cream)] hover:ring-[var(--lamp)]/50"
        }`}
      >
        {/* The bloom, on its own layer so switching it on is one composited
            opacity rather than a repaint -- the same lamp that sits behind a
            selected activity, doing the same job for the same reason. */}
        {lit && (
          <motion.span
            aria-hidden
            className="pointer-events-none absolute inset-[-7px] rounded-full"
            style={{
              background:
                "radial-gradient(circle, rgba(242,194,48,0.8), transparent 70%)",
              filter: "blur(6px)",
            }}
            animate={reduceMotion ? { opacity: 0.85 } : { opacity: [0.55, 1, 0.55] }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : { duration: 2.4, repeat: Infinity, ease: "easeInOut" }
            }
          />
        )}

        <svg
          aria-hidden
          viewBox="0 0 20 20"
          className="relative z-10 h-[18px] w-[18px] fill-none stroke-current"
          strokeWidth={1.5}
        >
          <path
            d="M17 11.5c0 1.7-1.6 3-3.5 3H8l-3.5 2.5V14A3.2 3.2 0 0 1 3 11.5v-5C3 4.8 4.6 3.5 6.5 3.5h7C15.4 3.5 17 4.8 17 6.5z"
            strokeLinejoin="round"
          />
        </svg>

        {unread > 0 && (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 z-10 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--dress)] px-1 font-sans text-[0.6rem] leading-none text-[#3a2c06]"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
    </div>
  );
}
