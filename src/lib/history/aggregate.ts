import type { MemeId } from "@/lib/rtc/protocol";

/**
 * Accumulates meme counts in memory. Flushed once at session end — writing
 * per gesture would put a network round trip on the hot path.
 */
export class MemeCounter {
  private counts = new Map<MemeId, number>();

  record(id: MemeId): void {
    this.counts.set(id, (this.counts.get(id) ?? 0) + 1);
  }

  get total(): number {
    let n = 0;
    for (const v of this.counts.values()) n += v;
    return n;
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.counts);
  }
}

export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}
