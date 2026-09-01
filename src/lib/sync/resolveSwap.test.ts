import { describe, it, expect } from "vitest";
import { shouldReplace } from "./resolveSwap";

describe("shouldReplace", () => {
  it("accepts anything when nothing is showing", () => {
    expect(shouldReplace(null, { showAt: 100, key: 1 })).toBe(true);
  });

  it("accepts a later instant", () => {
    expect(shouldReplace({ showAt: 100, key: 1 }, { showAt: 200, key: 9 })).toBe(
      true,
    );
  });

  it("rejects an earlier instant", () => {
    // A message delayed in flight must not undo something newer.
    expect(shouldReplace({ showAt: 200, key: 1 }, { showAt: 100, key: 9 })).toBe(
      false,
    );
  });

  it("breaks an exact tie by the lower key", () => {
    expect(shouldReplace({ showAt: 100, key: 5 }, { showAt: 100, key: 3 })).toBe(
      true,
    );
    expect(shouldReplace({ showAt: 100, key: 3 }, { showAt: 100, key: 5 })).toBe(
      false,
    );
  });

  it("rejects an identical repeat", () => {
    expect(shouldReplace({ showAt: 100, key: 3 }, { showAt: 100, key: 3 })).toBe(
      false,
    );
  });

  it("lands both peers on the same result from the same pair", () => {
    // The property that matters. Each side sees the two messages in whatever
    // order the network delivers them; both must still finish on one winner.
    const a = { showAt: 100, key: 7 };
    const b = { showAt: 100, key: 4 };

    // Peer 1 sees a first, then b.
    let peer1 = a;
    if (shouldReplace(peer1, b)) peer1 = b;

    // Peer 2 sees b first, then a.
    let peer2 = b;
    if (shouldReplace(peer2, a)) peer2 = a;

    expect(peer1).toEqual(peer2);
  });

  it("converges regardless of arrival order when instants differ", () => {
    const early = { showAt: 100, key: 1 };
    const late = { showAt: 250, key: 9 };

    let peer1 = early;
    if (shouldReplace(peer1, late)) peer1 = late;

    let peer2 = late;
    if (shouldReplace(peer2, early)) peer2 = early;

    expect(peer1).toEqual(peer2);
    expect(peer1).toEqual(late);
  });
});
