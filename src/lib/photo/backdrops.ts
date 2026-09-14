"use client";

import { useEffect, useState } from "react";
import type { Theme } from "./themes";

const cache = new Map<string, HTMLImageElement | null>();
const pending = new Map<string, Promise<HTMLImageElement | null>>();

/** Loads once per URL; a failed decorative scene is always safe to fall back from. */
export function loadBackdrop(url: string): Promise<HTMLImageElement | null> {
  const settled = cache.get(url);
  if (settled !== undefined || cache.has(url)) return Promise.resolve(settled ?? null);
  const existing = pending.get(url);
  if (existing) return existing;
  if (typeof Image === "undefined") return Promise.resolve(null);

  const request = new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      cache.set(url, image);
      pending.delete(url);
      resolve(image);
    };
    image.onerror = () => {
      cache.set(url, null);
      pending.delete(url);
      resolve(null);
    };
    image.src = url;
  });
  pending.set(url, request);
  return request;
}

/** Returns a settled backdrop, while starting its request when needed. */
export function backdropImage(url: string): HTMLImageElement | null {
  if (!cache.has(url)) void loadBackdrop(url);
  return cache.get(url) ?? null;
}

/** Lets canvas callers repaint the instant a theme's picture is ready. */
export function useBackdropReady(t: Theme): boolean {
  const url = t.backdrop;
  const [, rerender] = useState(0);

  useEffect(() => {
    if (url !== null) void loadBackdrop(url).then(() => rerender((version) => version + 1));
  }, [url]);

  return url !== null && backdropImage(url) !== null;
}
