"use client";

import { useCallback, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
/** Holds the choice when localStorage refuses to keep it. */
const memory = new Map<string, boolean>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // Another tab flipping the same switch should show up here too.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function read(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) return raw === "true";
  } catch {
    // Private browsing can refuse storage outright. Not a reason to break.
  }
  return memory.get(key) ?? fallback;
}

function write(key: string, next: boolean) {
  memory.set(key, next);
  try {
    localStorage.setItem(key, String(next));
  } catch {
    // Cannot survive a refresh, but the session still honours the choice.
  }
  for (const notify of listeners) notify();
}

/**
 * A boolean the browser remembers.
 *
 * Device-local by construction: nothing here crosses the DataChannel, so one
 * person's switch can never move the other's. The server snapshot is the
 * fallback, which keeps the first client render identical to the SSR output.
 */
export function usePersistentToggle(
  key: string,
  fallback: boolean,
): [boolean, (next: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => read(key, fallback),
    () => fallback,
  );

  const set = useCallback((next: boolean) => write(key, next), [key]);

  return [value, set];
}
