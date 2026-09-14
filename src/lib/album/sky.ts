import type { AlbumItem } from "./types";

export interface SkyLantern {
  item: AlbumItem;
  slot: number;
  scale: number;
  depth: number;
  opacity: number;
  x: number;
  y: number;
  duration: number;
  amplitude: number;
  delay: number;
  sway: number;
}

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function random(id: string, salt: number): number {
  return ((hash(`${id}:${salt}`) >>> 0) % 10_000) / 10_000;
}

/** The small, repeatable variations that stop the sky looking mechanically laid out. */
export function skyLanterns(items: AlbumItem[], selectedId: string | null): SkyLantern[] {
  const selectedIndex = Math.max(0, items.findIndex((item) => item.id === selectedId));
  const start = Math.max(0, selectedIndex - 3);
  const end = Math.min(items.length, selectedIndex + 4);

  return items.slice(start, end).map((item, index) => {
    const itemIndex = start + index;
    const slot = itemIndex - selectedIndex;
    const distance = Math.abs(slot);
    const selected = slot === 0;
    const side = slot === 0 ? 0 : Math.sign(slot);

    return {
      item,
      slot,
      scale: selected ? 1 : 1 - distance * 0.17,
      depth: distance,
      opacity: selected ? 1 : 1 - distance * 0.19,
      x: selected ? 50 : 50 + side * (16 + distance * 10) + (random(item.id, 1) - 0.5) * 3,
      y: selected ? 50 : 50 + (random(item.id, 2) - 0.5) * 22,
      duration: 7 + random(item.id, 3) * 5,
      amplitude: 5 + random(item.id, 4) * 7,
      delay: -random(item.id, 5) * 8,
      sway: (random(item.id, 6) - 0.5) * 5,
    };
  });
}

/** Move through a fixed order without wrapping from the first memory to the last. */
export function stepSelection(
  ids: string[],
  currentId: string | null,
  direction: -1 | 1,
): string | null {
  if (ids.length === 0) return null;
  const currentIndex = ids.indexOf(currentId ?? "");
  const index = currentIndex < 0 ? 0 : currentIndex;
  return ids[Math.max(0, Math.min(ids.length - 1, index + direction))] ?? null;
}
