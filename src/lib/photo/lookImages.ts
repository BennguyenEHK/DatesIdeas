"use client";

import { useEffect, useState } from "react";
const images = new Map<string, HTMLImageElement | null>();
const requests = new Map<string, Promise<HTMLImageElement | null>>();

/** Loads a signed look layer without letting one expired link break development. */
export function loadLookImage(url: string): Promise<HTMLImageElement | null> {
  if (images.has(url)) return Promise.resolve(images.get(url) ?? null);
  const existing = requests.get(url);
  if (existing) return existing;
  if (typeof Image === "undefined") return Promise.resolve(null);

  const request = new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      images.set(url, image);
      requests.delete(url);
      resolve(image);
    };
    image.onerror = () => {
      images.set(url, null);
      requests.delete(url);
      resolve(null);
    };
    image.src = url;
  });
  requests.set(url, request);
  return request;
}

export function lookImage(url: string): HTMLImageElement | null {
  if (!images.has(url)) void loadLookImage(url);
  return images.get(url) ?? null;
}

export function useLookImageReady(url: string | null): boolean {
  const [, rerender] = useState(0);
  useEffect(() => {
    if (url !== null) void loadLookImage(url).then(() => rerender((version) => version + 1));
  }, [url]);
  return url !== null && lookImage(url) !== null;
}
