"use client";

import type { LookbookView } from "@/lib/lookbook/contract";
import type { Outfit } from "@/lib/lookbook/types";
import { Wardrobe } from "./Wardrobe";
import { OutfitBoard } from "./OutfitBoard";
import { OutfitList } from "./OutfitList";

export function LookbookStage({
  view,
  onKeepInAlbum,
}: {
  view: LookbookView;
  onKeepInAlbum: (outfit: Outfit, png: Blob) => Promise<boolean>;
}) {
  if (view.status === "unpaired") return null;
  if (view.status === "loading") {
    return <p className="p-6 text-sm text-[var(--mist)]">Opening the lookbook&hellip;</p>;
  }
  if (view.status === "error") {
    return (
      <div className="flex flex-col gap-3 p-6 text-sm text-[var(--mist)]">
        <p>{view.error ?? "The lookbook could not be opened."}</p>
        <button
          type="button"
          onClick={view.reload}
          className="min-h-10 w-fit text-[var(--lamp)] underline"
        >
          Try again
        </button>
      </div>
    );
  }
  return (
    <section
      aria-label="Lookbook"
      className="grid min-w-0 gap-4 p-3 text-[var(--cream)] sm:p-5 lg:grid-cols-[minmax(0,1fr)_20rem]"
    >
      {/* A div, not <main>: the room already has one, and a second main
          landmark inside it confuses screen readers. */}
      <div className="min-w-0">
        {view.open === null ? (
          <OutfitList view={view} />
        ) : (
          <>
            <button
              type="button"
              onClick={() => view.openOutfit(null)}
              className="mb-3 min-h-10 text-sm text-[var(--lamp)] underline"
            >
              Back to outfits
            </button>
            {/* Keyed by outfit, so opening another one starts a fresh board
                rather than carrying the last outfit's name and note over. */}
            <OutfitBoard
              key={view.open.id}
              view={view}
              outfit={view.open}
              onKeepInAlbum={onKeepInAlbum}
            />
          </>
        )}
      </div>
      <Wardrobe view={view} />
    </section>
  );
}
