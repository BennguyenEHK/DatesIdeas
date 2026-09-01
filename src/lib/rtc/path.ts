export interface PathInfo {
  /** True when media is going through a TURN relay instead of peer to peer. */
  relayed: boolean;
  /**
   * The browser's own round-trip measurement for this route, in milliseconds.
   * Taken at the ICE layer, below JavaScript — so unlike the DataChannel ping
   * it cannot be inflated by a busy main thread. Null until ICE has measured.
   */
  netRtt: number | null;
  localType: string | null;
  remoteType: string | null;
}

/** RTCStatsReport is Map-like. Only these two members are needed. */
export interface StatsLike {
  values(): Iterable<Record<string, unknown>>;
  get(id: string): Record<string, unknown> | undefined;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/**
 * Finds the route actually carrying the call and reports what it costs.
 *
 * ICE tests several routes at once and more than one can reach "succeeded",
 * while exactly one is in use. Picking the first success therefore describes
 * a route the call may not be on — which is worst precisely when someone is
 * asking why the call is slow.
 *
 * Three ways to identify the real one, most authoritative first: the
 * transport names it outright; failing that the ICE layer marks it nominated;
 * failing both, any succeeded pair is a better guess than nothing.
 */
export function selectPath(stats: StatsLike): PathInfo | null {
  const pairs: Record<string, unknown>[] = [];
  let selectedId: string | null = null;

  for (const report of stats.values()) {
    if (report.type === "candidate-pair") pairs.push(report);
    else if (report.type === "transport" && selectedId === null) {
      selectedId = str(report.selectedCandidatePairId);
    }
  }

  const succeeded = pairs.filter((p) => p.state === "succeeded");
  const chosen =
    (selectedId !== null ? stats.get(selectedId) : undefined) ??
    succeeded.find((p) => p.nominated === true) ??
    succeeded[0];

  if (!chosen || chosen.state !== "succeeded") return null;

  const local = str(chosen.localCandidateId);
  const remote = str(chosen.remoteCandidateId);
  const localCand = local !== null ? stats.get(local) : undefined;
  const remoteCand = remote !== null ? stats.get(remote) : undefined;

  const rtt = chosen.currentRoundTripTime;

  return {
    // Only claim a relay on positive evidence. Guessing one on a missing
    // candidate would send someone hunting a network fault that isn't there.
    relayed: localCand?.candidateType === "relay",
    // The spec reports seconds; people read milliseconds.
    netRtt: typeof rtt === "number" ? rtt * 1000 : null,
    localType: str(localCand?.candidateType),
    remoteType: str(remoteCand?.candidateType),
  };
}
