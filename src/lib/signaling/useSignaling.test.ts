import { describe, it, expect } from "vitest";
import { shouldOffer } from "./useSignaling";

describe("shouldOffer (glare tiebreak)", () => {
  it("the earlier joiner offers", () => {
    const me = { identity: "b", joinedAt: 100 };
    const them = { identity: "a", joinedAt: 200 };
    expect(shouldOffer(me, them)).toBe(true);
    expect(shouldOffer(them, me)).toBe(false);
  });

  it("breaks an exact tie by lexicographic identity", () => {
    const a = { identity: "aaa", joinedAt: 100 };
    const b = { identity: "bbb", joinedAt: 100 };
    expect(shouldOffer(a, b)).toBe(true);
    expect(shouldOffer(b, a)).toBe(false);
  });

  it("is always asymmetric — exactly one peer offers", () => {
    const pairs = [
      [{ identity: "x", joinedAt: 1 }, { identity: "y", joinedAt: 2 }],
      [{ identity: "y", joinedAt: 2 }, { identity: "x", joinedAt: 1 }],
      [{ identity: "m", joinedAt: 5 }, { identity: "n", joinedAt: 5 }],
    ] as const;
    for (const [p, q] of pairs) {
      expect(shouldOffer(p, q)).not.toBe(shouldOffer(q, p));
    }
  });
});
