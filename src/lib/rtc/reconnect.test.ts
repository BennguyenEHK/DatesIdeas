import { describe, expect, it } from "vitest";
import {
  DISCONNECTED_GRACE_MS,
  MAX_RESTART_BACKOFF_MS,
  RESTART_WATCHDOG_MS,
  connectionIsStillDown,
  restartBackoffMs,
  restartWaitMs,
  shouldRestart,
  type RestartCheck,
} from "./reconnect";

const check = (overrides: Partial<RestartCheck> = {}): RestartCheck => ({
  connectionState: "disconnected",
  iceConnectionState: "disconnected",
  offerer: true,
  lastRestartAt: null,
  now: 100_000,
  attempt: 0,
  restartPending: false,
  ...overrides,
});

describe("DISCONNECTED_GRACE_MS", () => {
  it("gives a long, congested route time to heal itself", () => {
    // A single missed ICE check on a 290 ms path reads as "disconnected" and
    // usually heals within five to fifteen seconds. Four was too short.
    expect(DISCONNECTED_GRACE_MS).toBe(12_000);
  });
});

describe("RESTART_WATCHDOG_MS", () => {
  it("checks a lost restart handshake after twenty seconds", () => {
    expect(RESTART_WATCHDOG_MS).toBe(20_000);
  });
});

describe("restartBackoffMs", () => {
  it("restarts the first time without waiting", () => {
    expect(restartBackoffMs(0)).toBe(0);
  });

  it("doubles from fifteen seconds", () => {
    expect(restartBackoffMs(1)).toBe(15_000);
    expect(restartBackoffMs(2)).toBe(30_000);
    expect(restartBackoffMs(3)).toBe(60_000);
  });

  it("never waits longer than a minute", () => {
    expect(restartBackoffMs(4)).toBe(MAX_RESTART_BACKOFF_MS);
    expect(restartBackoffMs(50)).toBe(60_000);
  });

  it("treats a negative attempt as the first", () => {
    expect(restartBackoffMs(-1)).toBe(0);
  });
});

describe("restartWaitMs", () => {
  it("is zero when there has never been a restart", () => {
    expect(restartWaitMs({ lastRestartAt: null, now: 5, attempt: 3 })).toBe(0);
  });

  it("is the remainder of the backoff window", () => {
    expect(
      restartWaitMs({ lastRestartAt: 100_000, now: 110_000, attempt: 1 }),
    ).toBe(5_000);
  });

  it("is zero once the window has passed", () => {
    expect(
      restartWaitMs({ lastRestartAt: 100_000, now: 131_000, attempt: 2 }),
    ).toBe(0);
  });
});

describe("shouldRestart", () => {
  it("restarts a connection that is still disconnected after the grace", () => {
    expect(shouldRestart(check())).toBe(true);
  });

  it("restarts a failed connection", () => {
    expect(
      shouldRestart(
        check({ connectionState: "failed", iceConnectionState: "failed" }),
      ),
    ).toBe(true);
  });

  it("leaves the restart to the side that made the offer", () => {
    expect(shouldRestart(check({ offerer: false }))).toBe(false);
  });

  it("leaves a connection that healed during the grace alone", () => {
    expect(
      shouldRestart(
        check({
          connectionState: "connected",
          iceConnectionState: "connected",
        }),
      ),
    ).toBe(false);
    expect(shouldRestart(check({ connectionState: "connecting" }))).toBe(false);
  });

  it("waits when ICE has already found a working pair again", () => {
    expect(shouldRestart(check({ iceConnectionState: "connected" }))).toBe(
      false,
    );
    expect(shouldRestart(check({ iceConnectionState: "completed" }))).toBe(
      false,
    );
  });

  it("holds back inside the backoff window of the previous restart", () => {
    expect(
      shouldRestart(check({ lastRestartAt: 90_000, now: 100_000, attempt: 1 })),
    ).toBe(false);
  });

  it("restarts again once the backoff window has passed", () => {
    expect(
      shouldRestart(check({ lastRestartAt: 80_000, now: 100_000, attempt: 1 })),
    ).toBe(true);
  });

  it("restarts a pending handshake that remains connecting", () => {
    expect(
      shouldRestart(
        check({ connectionState: "connecting", restartPending: true }),
      ),
    ).toBe(true);
  });
});

describe("connectionIsStillDown", () => {
  it("counts every non-connected state while a restart is pending", () => {
    for (const connectionState of ["new", "connecting", "disconnected", "failed"] as const) {
      expect(connectionIsStillDown({ connectionState, restartPending: true })).toBe(
        true,
      );
    }
  });

  it("does not treat the first connection's connecting state as a failure", () => {
    expect(
      connectionIsStillDown({ connectionState: "connecting", restartPending: false }),
    ).toBe(false);
  });
});
