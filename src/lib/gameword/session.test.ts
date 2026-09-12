import { describe, it, expect } from "vitest";
import {
  EMPTY_SESSION,
  localMove,
  opponentOf,
  remoteMove,
  shouldAdopt,
  startSession,
  type Session,
} from "./session";

const BEN = "ben";
const K = "k";
const start = (nonce: string) => ({ game: "tictactoe" as const, players: [BEN, K] as const, nonce });

describe("starting", () => {
  it("adopts a game when there is none here", () => {
    expect(shouldAdopt(EMPTY_SESSION, start("n1"))).toBe(true);
  });

  it("adopts a new game once the one here has begun or ended", () => {
    const begun = localMove(startSession(start("n1")), { kind: "place", index: 4 }, BEN).session;
    expect(shouldAdopt(begun, start("n2"))).toBe(true);
  });

  it("does not adopt its own game echoed back", () => {
    expect(shouldAdopt(startSession(start("n1")), start("n1"))).toBe(false);
  });

  it("settles two simultaneous starts on the same game on both screens", () => {
    // Both pressed start before hearing from the other. Each side receives the
    // other's start while holding its own fresh one, and both must keep the
    // same one or the boards would diverge before the first move.
    const mine = startSession(start("aaa"));
    const theirs = startSession(start("zzz"));
    const benKeepsOwn = !shouldAdopt(mine, start("zzz"));
    const kKeepsOwn = !shouldAdopt(theirs, start("aaa"));
    // Exactly one side adopts, so both end on the same nonce.
    expect(benKeepsOwn).not.toBe(kKeepsOwn);
    const benEnds = benKeepsOwn ? "aaa" : "zzz";
    const kEnds = kKeepsOwn ? "zzz" : "aaa";
    expect(benEnds).toBe(kEnds);
  });
});

describe("moves", () => {
  it("records an accepted local move in the history", () => {
    const { session, accepted } = localMove(startSession(start("n1")), { kind: "place", index: 0 }, BEN);
    expect(accepted).toBe(true);
    expect(session.history).toEqual([{ kind: "place", index: 0 }]);
  });

  it("keeps the refusal reason for the person who tried", () => {
    const { session, accepted } = localMove(startSession(start("n1")), { kind: "place", index: 0 }, K);
    expect(accepted).toBe(false);
    expect(session.error).toBe("It is not your turn.");
  });

  it("applies the other person's move to the same board", () => {
    const afterBen = localMove(startSession(start("n1")), { kind: "place", index: 4 }, BEN).session;
    const onKsScreen = remoteMove(startSession(start("n1")), "n1", { kind: "place", index: 4 }, BEN);
    expect(onKsScreen.game).toEqual(afterBen.game);
  });

  it("ignores a move from a previous game", () => {
    const fresh = startSession(start("n2"));
    expect(remoteMove(fresh, "n1", { kind: "place", index: 4 }, BEN)).toBe(fresh);
  });

  it("ignores a refused remote move instead of showing an error", () => {
    // The other side ran the same rules before sending, so this can only be a
    // duplicate or a stale message -- nobody on this screen did anything wrong.
    const session = startSession(start("n1"));
    const after = remoteMove(session, "n1", { kind: "place", index: 4 }, K);
    expect(after).toBe(session);
    expect(after.error).toBeNull();
  });
});

describe("opponentOf", () => {
  it("names the other player from either seat", () => {
    const session: Session = startSession(start("n1"));
    expect(opponentOf(session, BEN)).toBe(K);
    expect(opponentOf(session, K)).toBe(BEN);
    expect(opponentOf(session, "stranger")).toBeNull();
    expect(opponentOf(EMPTY_SESSION, BEN)).toBeNull();
  });
});
