export interface Swap {
  /** Shared-clock instant the change is meant to take effect. */
  showAt: number;
  /** Tie-break identity. Any stable number unique to the thing being shown. */
  key: number;
}

/**
 * Decides whether an incoming change replaces what is on screen.
 *
 * Both peers can act at the same moment — two Draw taps, two activity
 * switches — and both then receive both messages. Each side runs this over
 * the same pair and therefore reaches the same answer independently, which is
 * what stops the two screens ending up on different things.
 *
 * Later instant wins. On an exact tie the lower key wins: arbitrary, but
 * arbitrary and identical on both sides is all determinism requires.
 */
export function shouldReplace(current: Swap | null, incoming: Swap): boolean {
  if (current === null) return true;
  if (incoming.showAt !== current.showAt) return incoming.showAt > current.showAt;
  return incoming.key < current.key;
}
