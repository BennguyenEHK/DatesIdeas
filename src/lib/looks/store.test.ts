import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { deleteLook, insertLook, listLooks, lookCount } = await import("./store");

const pair = "11111111-2222-3333-8444-555555555555";
function sql(result: unknown[]) {
  return async () => result;
}

describe("look store", () => {
  it("reads database rows and ignores malformed ones", async () => {
    const rows = await listLooks(
      sql([
        {
          id: "abcdef",
          pair_id: pair,
          name: "Blue hour",
          shots: 2,
          ink: "#123abc",
          backdrop_key: "a",
          overlay_key: "b",
          created_at: new Date("2026-01-01"),
        },
        { id: "bad" },
      ]),
      pair,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Blue hour");
  });

  it("persists and scopes destructive operations to the pair", async () => {
    expect(
      await insertLook(sql([{ id: "abcdef" }]), {
        id: "abcdef",
        pairId: pair,
        name: "Glow",
        shots: 1,
        ink: "#ffffff",
        backdropKey: "a",
        overlayKey: "b",
      }),
    ).toBe(true);
    expect(await lookCount(sql([{ n: 3 }]), pair)).toBe(3);
    await expect(deleteLook(sql([{ backdrop_key: "a", overlay_key: "b" }]), pair, "abcdef")).resolves.toEqual(
      { backdropKey: "a", overlayKey: "b" },
    );
  });
});
