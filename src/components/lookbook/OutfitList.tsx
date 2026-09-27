"use client";

import type { LookbookView } from "@/lib/lookbook/contract";
import type { Outfit } from "@/lib/lookbook/types";

function friendlyDay(day: string | null): string {
  if (day === null) return "No day yet";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
    new Date(`${day}T12:00:00`),
  );
}

export function OutfitList({ view }: { view: LookbookView }) {
  return (
    <section aria-label="Outfits">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--mist)]">Lookbook</p>
          <h1 className="font-display text-2xl text-[var(--lamp)]">Our outfits</h1>
        </div>
        <button
          type="button"
          onClick={() => void view.createOutfit()}
          className="min-h-10 rounded border border-[var(--edge)] px-3 text-sm"
        >
          New outfit
        </button>
      </div>
      {view.outfits.length === 0 ? (
        <div className="border border-dashed border-[var(--edge)] p-8 text-center text-sm text-[var(--mist)]">
          Make your first outfit from the pieces in your wardrobe.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {view.outfits.map((outfit) => (
            <OutfitCard
              key={outfit.id}
              outfit={outfit}
              pieces={view.pieces}
              onOpen={() => view.openOutfit(outfit.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function OutfitCard({
  outfit,
  pieces,
  onOpen,
}: {
  outfit: Outfit;
  pieces: LookbookView["pieces"];
  onOpen: () => void;
}) {
  const images = outfit.layout
    .slice()
    .sort((a, b) => a.z - b.z)
    .map((place) => pieces.find((piece) => piece.id === place.pieceId))
    .filter(Boolean)
    .slice(-3);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="min-h-40 rounded border border-[var(--edge)] bg-[var(--dusk)] p-3 text-left transition-colors hover:border-[var(--lamp)] motion-reduce:transition-none"
    >
      <div className="relative mb-3 aspect-[4/3] overflow-hidden bg-[var(--cream)]">
        {images.map((piece, index) => (
          // eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived storage link that next/image cannot optimise.
          <img
            key={piece!.id}
            src={piece!.url}
            alt=""
            crossOrigin="anonymous"
            className="absolute left-1/2 top-1/2 h-4/5 w-2/5 -translate-x-1/2 -translate-y-1/2 object-contain"
            style={{
              transform: `translate(-50%, -50%) translate(${index * 18}px, ${index * -8}px)`,
            }}
          />
        ))}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-display text-lg">{outfit.name}</span>
        <span className="text-sm text-[var(--lamp)]">♥ {outfit.lovedBy.length}</span>
      </div>
      <p className="mt-1 text-xs text-[var(--mist)]">{friendlyDay(outfit.wearOn)}</p>
    </button>
  );
}
