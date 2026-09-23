/**
 * How long a "disconnected" connection is left alone to heal itself before it
 * is torn down and rebuilt with an ICE restart.
 *
 * It used to be four seconds, and that was too short for the route this app
 * actually runs on. On a 290 ms, congested path Chrome reports
 * "disconnected" after a single missed ICE check, and the pair usually answers
 * again within five to fifteen seconds. A restart fired before then throws
 * away a route that was about to recover and replaces it with ten or more
 * seconds of renegotiation -- which is exactly the drop the restart was meant
 * to prevent.
 */
export const DISCONNECTED_GRACE_MS = 12_000;

/**
 * How long a connection must stay up before its earlier restarts are
 * forgiven. Shorter, and a route that fails every minute would restart at full
 * speed every time; this is what lets the backoff below actually accumulate.
 */
export const RESTART_FORGIVEN_AFTER_MS = 60_000;

/** The longest a failing connection waits between two restarts. */
export const MAX_RESTART_BACKOFF_MS = 60_000;

/** Why the connection was last rebuilt, as the report prints it. */
export type RestartReason = "disconnected" | "failed" | "peer-restarted";

/** What the report needs to know about the call's recoveries. */
export interface Resilience {
  restarts: number;
  lastRestartReason: RestartReason | null;
  /** Epoch ms of the last restart, or null when there has not been one. */
  lastRestartAt: number | null;
  /** The longest stretch from losing the connection to having it back, ms. */
  longestGapMs: number | null;
}

export const NO_RESTARTS: Resilience = {
  restarts: 0,
  lastRestartReason: null,
  lastRestartAt: null,
  longestGapMs: null,
};

/**
 * How long to wait after the previous restart before another may start.
 *
 * `attempt` is the number of restarts already made since the connection was
 * last healthy for a while. The first is immediate; after that the waits
 * double from fifteen seconds up to a minute. A route that keeps collapsing is
 * not fixed by rebuilding it faster, and every restart is a renegotiation that
 * competes with the call for the same congested link.
 */
export function restartBackoffMs(attempt: number): number {
  if (attempt <= 0) return 0;
  return Math.min(MAX_RESTART_BACKOFF_MS, 15_000 * 2 ** (attempt - 1));
}

export interface RestartCheck {
  connectionState: RTCPeerConnectionState;
  iceConnectionState: RTCIceConnectionState;
  /** Only the side that made the offer may restart, or both would collide. */
  offerer: boolean;
  lastRestartAt: number | null;
  now: number;
  attempt: number;
}

/** Milliseconds until the backoff allows another restart; 0 when it already does. */
export function restartWaitMs(
  check: Pick<RestartCheck, "lastRestartAt" | "now" | "attempt">,
): number {
  if (check.lastRestartAt === null) return 0;
  const due = check.lastRestartAt + restartBackoffMs(check.attempt);
  return Math.max(0, due - check.now);
}

/**
 * Whether this side should restart ICE now.
 *
 * Called after the grace period, against the LIVE state rather than the one
 * that started the timer: the browser is allowed to heal a connection on its
 * own, and restarting a healthy one is the one way this can make things worse.
 * An ICE layer that has found a working pair again is treated the same way,
 * because the connection state follows it a moment later.
 */
export function shouldRestart(check: RestartCheck): boolean {
  if (!check.offerer) return false;
  const lost =
    check.connectionState === "disconnected" ||
    check.connectionState === "failed";
  if (!lost) return false;
  if (
    check.iceConnectionState === "connected" ||
    check.iceConnectionState === "completed"
  ) {
    return false;
  }
  return restartWaitMs(check) === 0;
}
