"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "motion/react";
import { FAN_MAX, FAN_RADIUS, FAN_SPREAD_DEG, fanLayout, stackEdges } from "@/lib/album/fan";
import type { Frame } from "@/lib/album/types";

const FRAME_H = 54;
const FRAME_W = 76;
const FAN_CARD_H = 96;
const FAN_CARD_W = 72;
const HOVER_DELAY = 250;
/** How long after opening a reel scroll moves the fan instead of closing it. */
const SCROLL_FOLLOW_MS = 800;
/** How far the outermost card's centre sits from the stack's centre. */
const FAN_REACH = Math.ceil(Math.sin(((FAN_SPREAD_DEG / 2) * Math.PI) / 180) * FAN_RADIUS);

type Anchor = { left: number; top: number };

/** A grouped reel frame: a closed pile of prints that can be fanned into a picker. */
export function ReelStack({
  frame,
  index,
  selected,
  onSelect,
}: {
  frame: Frame;
  index: number;
  selected: boolean;
  onSelect: (itemId: string) => void;
}) {
  const stackRef = useRef<HTMLButtonElement>(null);
  const hoverTimer = useRef<number | null>(null);
  const focusFirst = useRef(false);
  const fanId = useId();
  const reduceMotion = useReducedMotion();
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  const clearHoverTimer = useCallback(() => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  }, []);

  const close = useCallback((returnFocus = false) => {
    clearHoverTimer();
    setAnchor(null);
    if (returnFocus) stackRef.current?.focus();
  }, [clearHoverTimer]);

  // When the fan last opened. Selecting a stack scrolls the reel to centre it,
  // and that scroll arrives just after the fan opens; it must move the fan with
  // the stack rather than close it.
  const openedAt = useRef(0);

  const measure = useCallback((): Anchor | null => {
    const stack = stackRef.current;
    if (stack === null) return null;
    const rect = stack.getBoundingClientRect();
    // Keep the whole spread on screen, not just the middle card: the outer cards
    // sit up to FAN_REACH either side of the centre.
    const margin = FAN_REACH + FAN_CARD_W / 2 + 8;
    const left = Math.min(
      Math.max(margin, rect.left + rect.width / 2),
      Math.max(margin, window.innerWidth - margin),
    );
    return { left, top: rect.top - FAN_CARD_H - 8 };
  }, []);

  const open = (keyboard = false) => {
    const next = measure();
    if (next === null) return;
    clearHoverTimer();
    openedAt.current = Date.now();
    window.dispatchEvent(new CustomEvent("reel-stack-open", { detail: fanId }));
    setAnchor(next);

    focusFirst.current = keyboard;
  };

  const scheduleClose = (event: React.PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    clearHoverTimer();
    hoverTimer.current = window.setTimeout(() => close(), HOVER_DELAY);
  };

  const cancelClose = (event: React.PointerEvent) => {
    if (event.pointerType === "mouse") clearHoverTimer();
  };

  useEffect(() => {
    const closeForOtherFan = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== fanId) close();
    };
    const closeForScroll = () => {
      if (anchor === null) return;
      if (Date.now() - openedAt.current < SCROLL_FOLLOW_MS) {
        const next = measure();
        if (next !== null) setAnchor(next);
        return;
      }
      close();
    };
    const closeForOutsideClick = (event: MouseEvent) => {
      if (anchor === null) return;
      const target = event.target as Node;
      if (!stackRef.current?.contains(target) && !document.getElementById(fanId)?.contains(target)) close();
    };
    const closeForEscape = (event: KeyboardEvent) => {
      if (anchor !== null && event.key === "Escape") close(true);
    };
    const closeForTab = (event: KeyboardEvent) => {
      if (anchor !== null && event.key === "Tab") close();
    };
    const moveFanFocus = (event: KeyboardEvent) => {
      if (anchor === null || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
      const cards = Array.from(document.querySelectorAll<HTMLButtonElement>(`[data-reel-fan-card="${fanId}"]`));
      const at = cards.indexOf(document.activeElement as HTMLButtonElement);
      if (at < 0) return;
      event.preventDefault();
      const next = event.key === "ArrowRight" ? Math.min(cards.length - 1, at + 1) : Math.max(0, at - 1);
      cards[next]?.focus();
    };

    window.addEventListener("reel-stack-open", closeForOtherFan);
    window.addEventListener("reel-stack-close", closeForScroll);
    document.addEventListener("mousedown", closeForOutsideClick);
    document.addEventListener("keydown", closeForEscape);
    document.addEventListener("keydown", closeForTab);
    document.addEventListener("keydown", moveFanFocus);
    return () => {
      clearHoverTimer();
      window.removeEventListener("reel-stack-open", closeForOtherFan);
      window.removeEventListener("reel-stack-close", closeForScroll);
      document.removeEventListener("mousedown", closeForOutsideClick);
      document.removeEventListener("keydown", closeForEscape);
      document.removeEventListener("keydown", closeForTab);
      document.removeEventListener("keydown", moveFanFocus);
    };
  }, [anchor, clearHoverTimer, close, fanId, measure]);

  const edges = stackEdges(frame.count);
  const fan = fanLayout(frame.count);

  return (
    <div
      data-reel-stack
      className="relative h-[60px] w-[82px] shrink-0"
      onPointerEnter={cancelClose}
      onPointerLeave={scheduleClose}
    >
      {Array.from({ length: edges }, (_, edge) => {
        const item = frame.items[edge + 1];
        if (item === undefined) return null;
        const still = item.posterUrl ?? item.url;
        return (
          <div
            key={item.id}
            aria-hidden
            className="absolute bottom-0 left-0 overflow-hidden bg-[#0b0e1e] shadow-[0_1px_0_rgba(245,239,224,0.2)]"
            style={{
              width: FRAME_W,
              height: FRAME_H,
              transform: `translate(${(edge + 1) * 3}px, -${(edge + 1) * 2}px) rotate(${(edge + 1) * 2}deg)`,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL on an unknown host. */}
            <img src={still} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
          </div>
        );
      })}

      <button
        ref={stackRef}
        type="button"
        role="option"
        aria-selected={selected}
        aria-current={selected}
        data-index={index}
        data-loved={frame.loved}
        className="reel-frame absolute bottom-0 left-0"
        style={{ width: FRAME_W, height: FRAME_H }}
        aria-label={`${frame.date}, ${frame.count} memories`}
        onClick={() => {
          onSelect(frame.item.id);
          open();
        }}
        onPointerEnter={(event) => {
          if (event.pointerType !== "mouse") return;
          clearHoverTimer();
          hoverTimer.current = window.setTimeout(() => open(), HOVER_DELAY);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onSelect(frame.item.id);
          open(true);
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL on an unknown host. */}
        <img
          src={frame.item.posterUrl ?? frame.item.url}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
        <span
          aria-hidden
          className="absolute bottom-0.5 right-0.5 rounded bg-[#05070f]/80 px-1 font-sans text-[9px] text-[var(--cream)]"
        >
          {frame.count}
        </span>
      </button>

      {anchor !== null
        ? createPortal(
            <div
              id={fanId}
              className="fixed z-50 h-0 w-0"
              style={{ left: anchor.left, top: anchor.top }}
              onPointerEnter={cancelClose}
              onPointerLeave={scheduleClose}
            >
              {fan.map((card, slot) => {
                const item = card.kind === "print" ? frame.items[card.index] : frame.items[FAN_MAX - 1];
                if (item === undefined) return null;
                const still = item.posterUrl ?? item.url;
                return (
                  <motion.button
                    key={card.kind === "print" ? item.id : "more"}
                    ref={
                      slot === 0
                        ? (node) => {
                            if (node !== null && focusFirst.current) {
                              node.focus();
                              focusFirst.current = false;
                            }
                          }
                        : undefined
                    }
                    type="button"
                    data-reel-fan-first={slot === 0 ? fanId : undefined}
                    data-reel-fan-card={fanId}
                    aria-label={
                      card.kind === "print"
                        ? `${frame.date}, memory ${card.index + 1}`
                        : `${frame.date}, ${card.hidden} more memories`
                    }
                    className="absolute overflow-hidden border border-[var(--cream)]/35 bg-[#0b0e1e] shadow-[0_10px_24px_rgba(0,0,0,0.45)]"
                    style={{ width: FAN_CARD_W, height: FAN_CARD_H, left: -FAN_CARD_W / 2, top: 0 }}
                    initial={reduceMotion ? false : { opacity: 0, x: 0, y: 28, rotate: 0 }}
                    // +y: fanLayout's outer cards sit LOWER than the middle one,
                    // so the spread arcs like a hand of cards, not a bowl.
                    animate={{ opacity: 1, x: card.x, y: card.y, rotate: card.rotateDeg }}
                    transition={reduceMotion ? { duration: 0 } : { duration: 0.3, delay: slot * 0.035 }}
                    onClick={() => {
                      onSelect(item.id);
                      close();
                    }}
                  >
                    {card.kind === "print" ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL on an unknown host. */}
                        <img src={still} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                      </>
                    ) : (
                      <span className="flex h-full items-center justify-center bg-[var(--dusk)] font-display text-2xl text-[var(--lamp)]">
                        +{card.hidden}
                      </span>
                    )}
                  </motion.button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
