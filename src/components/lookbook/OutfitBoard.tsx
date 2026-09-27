"use client";

import { useEffect, useRef, useState } from "react";
import type { LookbookView } from "@/lib/lookbook/contract";
import { SCALE_MAX, SCALE_MIN, type Outfit, type Placement } from "@/lib/lookbook/types";
import { renderOutfitPng } from "@/lib/lookbook/render";

/** Finger travel under this is a tap, not a drag. */
const TAP_SLOP_PX = 4;
/** The gap between live moves sent while dragging. */
const DRAG_INTERVAL_MS = 50;

export function OutfitBoard({
  view,
  outfit,
  onKeepInAlbum,
}: {
  view: LookbookView;
  outfit: Outfit;
  onKeepInAlbum: (outfit: Outfit, png: Blob) => Promise<boolean>;
}) {
  const board = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState(outfit.name);
  const [note, setNote] = useState(outfit.note);
  const [album, setAlbum] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  /**
   * The piece being dragged: where the finger landed relative to the piece's
   * centre, so the piece moves with the finger instead of jumping its centre
   * under it, and whether it has actually moved -- a tap that only selects a
   * piece must not send a move.
   */
  const drag = useRef<{
    id: string;
    offsetX: number;
    offsetY: number;
    startX: number;
    startY: number;
    moved: boolean;
    last: number;
  } | null>(null);
  const selectedPlace = outfit.layout.find((place) => place.pieceId === selected);
  const pieceFor = (placement: Placement) =>
    view.pieces.find((piece) => piece.id === placement.pieceId);
  const grab = (event: React.PointerEvent, placement: Placement) => {
    if (board.current === null) return;
    const rect = board.current.getBoundingClientRect();
    drag.current = {
      id: placement.pieceId,
      offsetX: event.clientX - (rect.left + placement.x * rect.width),
      offsetY: event.clientY - (rect.top + placement.y * rect.height),
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      last: 0,
    };
  };
  const move = (event: React.PointerEvent, placement: Placement, final = false) => {
    const held = drag.current;
    if (board.current === null || held === null || held.id !== placement.pieceId) return;
    if (
      !held.moved &&
      Math.hypot(event.clientX - held.startX, event.clientY - held.startY) < TAP_SLOP_PX
    ) {
      return;
    }
    held.moved = true;
    const now = event.timeStamp;
    // About twenty moves a second while dragging; the release always lands.
    if (!final && now - held.last < DRAG_INTERVAL_MS) return;
    held.last = now;
    const rect = board.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - held.offsetX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - held.offsetY - rect.top) / rect.height));
    view.place({ ...placement, x, y });
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (selectedPlace === undefined) return;
      // Keys typed into the name, the note or the date belong to those fields.
      // Backspace in the note used to take the selected piece off the board.
      const target = event.target as HTMLElement | null;
      if (
        target !== null &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      ) {
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        view.unplace(selectedPlace.pieceId);
        setSelected(null);
        return;
      }
      const delta =
        event.key === "ArrowLeft"
          ? [-0.02, 0]
          : event.key === "ArrowRight"
            ? [0.02, 0]
            : event.key === "ArrowUp"
              ? [0, -0.02]
              : event.key === "ArrowDown"
                ? [0, 0.02]
                : null;
      if (delta) {
        event.preventDefault();
        view.place({
          ...selectedPlace,
          x: Math.max(0, Math.min(1, selectedPlace.x + delta[0])),
          y: Math.max(0, Math.min(1, selectedPlace.y + delta[1])),
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedPlace, view]);
  const saveAlbum = async () => {
    setAlbum("saving");
    const png = await renderOutfitPng(outfit, view.pieces);
    const saved = png !== null && (await onKeepInAlbum(outfit, png));
    setAlbum(saved ? "saved" : "failed");
  };
  const resize = (amount: number) => {
    if (selectedPlace)
      view.place({
        ...selectedPlace,
        scale: Math.max(
          SCALE_MIN,
          Math.min(SCALE_MAX, Math.round((selectedPlace.scale + amount) * 10) / 10),
        ),
      });
  };
  const bringFront = () => {
    if (selectedPlace)
      view.place({
        ...selectedPlace,
        z: Math.max(-1, ...outfit.layout.map((place) => place.z)) + 1,
      });
  };
  return (
    <section aria-label="Outfit board">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <input
          aria-label="Outfit name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            if (name.trim() && name !== outfit.name) void view.rename(outfit.id, name.trim());
          }}
          className="min-h-10 min-w-0 flex-1 bg-transparent font-display text-xl text-[var(--lamp)] outline-none"
        />
        <button
          type="button"
          aria-label="Heart outfit"
          aria-pressed={outfit.lovedBy.includes(view.me)}
          onClick={() => void view.toggleLove(outfit.id)}
          className="min-h-10 px-2 text-lg"
        >
          {outfit.lovedBy.includes(view.me) ? "♥" : "♡"}{" "}
          <span className="text-sm">{outfit.lovedBy.length}</span>
        </button>
        <label className="flex min-h-10 items-center gap-1 text-xs text-[var(--mist)]">
          Wear on
          <input
            type="date"
            value={outfit.wearOn ?? ""}
            onChange={(event) => void view.setWearOn(outfit.id, event.target.value || null)}
            className="min-h-10 border border-[var(--edge)] bg-[var(--dusk)] px-1 text-[var(--cream)]"
          />
        </label>
      </header>
      <div
        ref={board}
        className="relative mx-auto aspect-[3/4] w-full max-w-[34rem] overflow-hidden border border-[var(--edge)] bg-[var(--cream)] touch-none"
        tabIndex={0}
      >
        {outfit.layout
          .slice()
          .sort((a, b) => a.z - b.z)
          .map((placement) => {
            const piece = pieceFor(placement);
            if (!piece) return null;
            return (
              <button
                key={placement.pieceId}
                type="button"
                onClick={() => setSelected(placement.pieceId)}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setSelected(placement.pieceId);
                  grab(event, placement);
                }}
                onPointerMove={(event) => move(event, placement)}
                onPointerUp={(event) => {
                  move(event, placement, true);
                  drag.current = null;
                }}
                className={`absolute h-[28%] w-[40%] -translate-x-1/2 -translate-y-1/2 cursor-grab object-contain ${selected === placement.pieceId ? "ring-2 ring-[var(--lamp)]" : ""}`}
                style={{
                  left: `${placement.x * 100}%`,
                  top: `${placement.y * 100}%`,
                  zIndex: placement.z,
                  transform: `translate(-50%, -50%) scale(${placement.scale})`,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived storage link that next/image cannot optimise. */}
                <img
                  src={piece.url}
                  alt={piece.label || piece.kind}
                  crossOrigin="anonymous"
                  className="h-full w-full object-contain"
                  draggable={false}
                />
              </button>
            );
          })}
      </div>
      {selectedPlace ? (
        <div className="mt-3 flex flex-wrap gap-2 border border-[var(--edge)] p-2">
          <button
            type="button"
            onClick={() => resize(-0.1)}
            className="min-h-10 min-w-10 border border-[var(--edge)]"
          >
            −
          </button>
          <span className="flex items-center px-2 text-sm">Size</span>
          <button
            type="button"
            onClick={() => resize(0.1)}
            className="min-h-10 min-w-10 border border-[var(--edge)]"
          >
            +
          </button>
          <button
            type="button"
            onClick={bringFront}
            className="min-h-10 border border-[var(--edge)] px-3"
          >
            Bring to front
          </button>
          <button
            type="button"
            onClick={() => {
              view.unplace(selectedPlace.pieceId);
              setSelected(null);
            }}
            className="min-h-10 border border-[var(--edge)] px-3 text-[var(--neon)]"
          >
            Remove
          </button>
        </div>
      ) : null}
      <label className="mt-3 block text-sm text-[var(--mist)]">
        Note
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          onBlur={() => {
            if (note !== outfit.note) void view.setNote(outfit.id, note);
          }}
          maxLength={280}
          className="mt-1 min-h-20 w-full border border-[var(--edge)] bg-[var(--dusk)] p-2 text-[var(--cream)]"
        />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void saveAlbum()}
          disabled={album === "saving"}
          className="min-h-10 border border-[var(--lamp)] px-3 text-[var(--lamp)]"
        >
          {album === "saving" ? "Saving…" : album === "saved" ? "Saved" : "Keep in album"}
        </button>
        <button
          type="button"
          onClick={() => {
            if (window.confirm("Delete this outfit?")) void view.deleteOutfit(outfit.id);
          }}
          className="min-h-10 px-3 text-[var(--neon)]"
        >
          Delete outfit
        </button>
        {album === "failed" ? (
          <span role="alert" className="flex items-center text-sm text-[var(--neon)]">
            Could not save.
          </span>
        ) : null}
      </div>
    </section>
  );
}
