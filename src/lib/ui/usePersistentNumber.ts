"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A number remembered on this device, the way usePersistentToggle remembers a
 * switch. Same shape for the same reason: read through useSyncExternalStore so
 * the server render and the first client render agree on the fallback, and
 * the stored value arrives on the next tick without a hydration mismatch.
 */
const listeners = new Set<() => void>();
const memory = new Map<string, number>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function read(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) return parsed;
    }
  } catch {
    // Private mode or blocked storage: the in-memory copy still works.
  }
  return memory.get(key) ?? fallback;
}

function write(key: string, next: number) {
  memory.set(key, next);
  try {
    localStorage.setItem(key, String(next));
  } catch {
    // Same: remembered for this page at least.
  }
  for (const notify of listeners) notify();
}

export function usePersistentNumber(
  key: string,
  fallback: number,
): [number, (next: number) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => read(key, fallback),
    () => fallback,
  );
  const set = useCallback((next: number) => write(key, next), [key]);
  return [value, set];
}
