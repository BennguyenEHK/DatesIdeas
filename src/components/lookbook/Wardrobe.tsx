"use client";

import { useState } from "react";
import type { LookbookView } from "@/lib/lookbook/contract";
import { PIECE_KINDS, type PieceKind } from "@/lib/lookbook/types";
import { AddPiece } from "./AddPiece";

const KIND_LABELS: Record<PieceKind, string> = {
  top: "Tops",
  bottom: "Bottoms",
  dress: "Dresses",
  outerwear: "Outerwear",
  shoes: "Shoes",
  bag: "Bags",
  accessory: "Accessories",
  other: "Other",
};

export function Wardrobe({ view }: { view: LookbookView }) {
  const [adding, setAdding] = useState(false);
  const openIds = new Set(view.open?.layout.map((place) => place.pieceId) ?? []);
  const maxZ = view.open?.layout.reduce((max, place) => Math.max(max, place.z), -1) ?? -1;
  const addToBoard = (pieceId: string) => {
    if (view.open === null || openIds.has(pieceId)) return;
    view.place({ pieceId, x: 0.5, y: 0.5, scale: 1, z: maxZ + 1 });
  };
  return (
    <aside
      aria-label="Wardrobe"
      className="min-w-0 border-t border-[var(--edge)] pt-4 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-display text-lg text-[var(--lamp)]">Wardrobe</h2>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="min-h-10 rounded border border-[var(--edge)] px-3 text-sm text-[var(--cream)]"
        >
          + Add piece
        </button>
      </div>
      <div className="space-y-5">
        {PIECE_KINDS.map((kind) => {
          const pieces = view.pieces.filter((piece) => piece.kind === kind);
          if (pieces.length === 0) return null;
          return (
            <section key={kind} aria-label={KIND_LABELS[kind]}>
              <h3 className="mb-2 text-xs uppercase tracking-[0.16em] text-[var(--mist)]">
                {KIND_LABELS[kind]}
              </h3>
              <div className="grid grid-cols-3 gap-2">
                {pieces.map((piece) => {
                  const onBoard = openIds.has(piece.id);
                  return (
                    <div key={piece.id} className="relative min-w-0">
                      <button
                        type="button"
                        onClick={() => addToBoard(piece.id)}
                        disabled={onBoard || view.open === null}
                        className="block w-full rounded border border-[var(--edge)] bg-[var(--dusk)] p-1 text-left disabled:opacity-60"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived storage link that next/image cannot optimise. */}
                        <img
                          src={piece.url}
                          alt={piece.label || kind}
                          className="aspect-square w-full object-contain"
                          crossOrigin="anonymous"
                        />
                        <span className="block truncate px-1 py-1 text-xs">
                          {piece.label || KIND_LABELS[kind]}
                        </span>
                        <span className="block px-1 pb-1 text-[0.65rem] text-[var(--mist)]">
                          {onBoard ? "on board" : piece.addedBy === view.me ? "yours" : "theirs"}
                        </span>
                      </button>
                      <details className="absolute right-1 top-1">
                        <summary
                          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-[var(--letterbox)]/80 text-lg"
                          aria-label={`Options for ${piece.label || kind}`}
                        >
                          …
                        </summary>
                        <div className="absolute right-0 z-10 mt-1 w-36 border border-[var(--edge)] bg-[var(--letterbox)] p-2 text-xs shadow-lg">
                          <label className="block text-[var(--mist)]">
                            Change kind
                            <select
                              value={piece.kind}
                              onChange={(event) =>
                                void view.updatePiece(piece.id, {
                                  kind: event.target.value as PieceKind,
                                })
                              }
                              className="mt-1 min-h-10 w-full bg-[var(--dusk)] text-[var(--cream)]"
                            >
                              {PIECE_KINDS.map((option) => (
                                <option key={option} value={option}>
                                  {KIND_LABELS[option]}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            type="button"
                            className="mt-2 min-h-10 text-[var(--neon)]"
                            onClick={() => {
                              if (window.confirm("Delete this piece?"))
                                void view.deletePiece(piece.id);
                            }}
                          >
                            Delete piece
                          </button>
                        </div>
                      </details>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      {adding ? <AddPiece view={view} onClose={() => setAdding(false)} /> : null}
    </aside>
  );
}
