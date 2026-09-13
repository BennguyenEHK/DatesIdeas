"use client";

import type { AlbumView } from "@/lib/together/useTogether";

/**
 * The album, open in the call for both of you. PLACEHOLDER -- the interface is
 * fixed; the body is being built.
 */
export interface RoomAlbumProps {
  /** Where both screens are. Follow it; never echo it back through onView. */
  view: AlbumView;
  /** Goes up when the other screen changed the album. Reload when it does. */
  revision: number;
  /** Call only for this person's own navigation. */
  onView: (view: AlbumView) => void;
  /** Call after this person adds, captions, loves or deletes something. */
  onChanged: () => void;
  /** Back to the call, for both of you. */
  onClose: () => void;
}

export function RoomAlbum({ onClose }: RoomAlbumProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-[var(--mist)]">
      <p className="text-sm">The album is on its way.</p>
      <button type="button" onClick={onClose} className="text-xs text-[var(--lamp)] underline">
        Back to the call
      </button>
    </div>
  );
}
