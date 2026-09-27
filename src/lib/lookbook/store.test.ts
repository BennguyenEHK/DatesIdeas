import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { pieceReceipt, receiptMatchesPiece, toOutfit, updateOutfit } = await import("./store");

describe("lookbook store", () => {
  it("binds a piece receipt to every uploaded property", () => {
    const receipt = pieceReceipt(
      "secret",
      "11111111-2222-3333-8444-555555555555",
      "abcdef",
      "lookbook/11111111-2222-3333-8444-555555555555/abcdef.jpg",
      "image/jpeg",
      12,
    );
    expect(
      receiptMatchesPiece(
        "secret",
        "11111111-2222-3333-8444-555555555555",
        "abcdef",
        "lookbook/11111111-2222-3333-8444-555555555555/abcdef.jpg",
        "image/jpeg",
        12,
        receipt,
      ),
    ).toBe(true);
    expect(
      receiptMatchesPiece(
        "secret",
        "11111111-2222-3333-8444-555555555555",
        "abcdef",
        "lookbook/11111111-2222-3333-8444-555555555555/abcdef.jpg",
        "image/jpeg",
        13,
        receipt,
      ),
    ).toBe(false);
  });
  it("keeps SQL dates as calendar days", () => {
    expect(
      toOutfit({
        id: "abcdef",
        pairId: "pair",
        name: "Day",
        wearOn: "2026-09-27",
        note: "",
        createdBy: "K",
        lovedBy: [],
        layout: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }).wearOn,
    ).toBe("2026-09-27");
  });

  it("keeps an outfit's day when a save does not mention it", async () => {
    // Every board save, rename and heart goes through this update. A day
    // cleared by any of them would vanish from the calendar without anyone
    // having touched it.
    const calls: unknown[][] = [];
    const sql = (_strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push(values);
      return Promise.resolve([]);
    };
    // The route hands over `wearOn: undefined` when the request left it out.
    await updateOutfit(sql, "pair", "abcdef", { name: "Brunch", wearOn: undefined });
    await updateOutfit(sql, "pair", "abcdef", { wearOn: null });
    await updateOutfit(sql, "pair", "abcdef", { wearOn: "2026-10-03" });
    // The value after "set wear_on?" is the CASE condition deciding it.
    const setsDay = (values: unknown[]) => values[1];
    expect(setsDay(calls[0])).toBe(false);
    expect(setsDay(calls[1])).toBe(true);
    expect(setsDay(calls[2])).toBe(true);
  });
});
