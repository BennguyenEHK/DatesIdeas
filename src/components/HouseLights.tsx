"use client";

import { useEffect } from "react";
import { DIM_DEPTH, DIM_DOWN_MS, DIM_UP_MS } from "@/lib/ui/houseLights";

/**
 * Takes the room's lights down while a film runs, and brings them back after.
 *
 * Renders nothing. It sets two custom properties on the document and lets CSS
 * do the rest, which is the whole point of the design: the room's colours are
 * derived from `--dim` in globals.css, so darkening them darkens every surface
 * built out of them and touches nothing else.
 *
 * This deliberately does NOT paint an overlay. An overlay large enough to shade
 * the room is necessarily large enough to cover the film, and can only stay off
 * the picture by winning a stacking-context argument with it -- which leaves a
 * full-viewport layer sitting on top of a video iframe and being repainted
 * every frame of the fade. Nothing is laid over the picture here at all.
 *
 * There is also nothing here that can gate playback. The film is not waiting on
 * this component, has no reference to it, and does not share a layer with it;
 * pressing play starts the film and the lights go down alongside it, at their
 * own pace, because the two are not connected by anything.
 */
export function HouseLights({ playing }: { playing: boolean }) {
  useEffect(() => {
    const root = document.documentElement;
    // Down promptly so the film can begin, back up more slowly, which is the
    // same asymmetry duck.ts uses to make a dip read as deliberate.
    root.style.setProperty("--dim-duration", `${playing ? DIM_DOWN_MS : DIM_UP_MS}ms`);
    root.style.setProperty("--dim-target", playing ? String(DIM_DEPTH) : "0");

    return () => {
      // Leaving movie mode must not leave the room dark. Cleared rather than
      // set to zero so the stylesheet's own default takes over again.
      root.style.removeProperty("--dim-target");
      root.style.removeProperty("--dim-duration");
    };
  }, [playing]);

  return null;
}
