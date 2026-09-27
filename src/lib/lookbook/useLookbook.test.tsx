import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LookbookClient } from "./contract";
import { useLookbook } from "./useLookbook";

const piece = {
  id: "piece01",
  kind: "top" as const,
  label: "shirt",
  addedBy: "me",
  url: "https://x",
  createdAt: "2026-01-01",
};
const outfit = {
  id: "outfit01",
  name: "Outfit 1",
  wearOn: null,
  note: "",
  createdBy: "me",
  lovedBy: [],
  layout: [],
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};
function fakeClient(): LookbookClient {
  return {
    listPieces: vi.fn(async () => ({ ok: true as const, value: [piece] })),
    listOutfits: vi.fn(async () => ({ ok: true as const, value: [outfit] })),
    addPiece: vi.fn(),
    updatePiece: vi.fn(),
    deletePiece: vi.fn(),
    createOutfit: vi.fn(async (fields) => ({
      ok: true as const,
      value: { ...outfit, id: "outfit02", ...fields },
    })),
    updateOutfit: vi.fn(async (id, patch) => ({
      ok: true as const,
      value: { ...outfit, id, ...patch },
    })),
    deleteOutfit: vi.fn(),
  } as unknown as LookbookClient;
}
function hook(client = fakeClient(), paired = true) {
  const send = vi.fn();
  const result = renderHook(() =>
    useLookbook({ active: true, paired, identity: "me", now: () => 10, send, client }),
  );
  return { ...result, client, send };
}
afterEach(() => vi.useRealTimers());

describe("useLookbook", () => {
  it("loads the wardrobe and reports an unpaired device", async () => {
    const loaded = hook();
    await waitFor(() => expect(loaded.result.current.view.status).toBe("ready"));
    expect(loaded.result.current.view.pieces).toEqual([piece]);
    const unpaired = hook(fakeClient(), false);
    await waitFor(() => expect(unpaired.result.current.view.status).toBe("unpaired"));
  });
  it("reloads after a changed peer message and applies only newer opens", async () => {
    const setup = hook();
    await waitFor(() => expect(setup.result.current.view.status).toBe("ready"));
    act(() => setup.result.current.accept({ t: "lookbook-changed" }));
    await waitFor(() => expect(setup.client.listPieces).toHaveBeenCalledTimes(2));
    act(() => setup.result.current.accept({ t: "lookbook-open", outfitId: "outfit01", at: 11 }));
    expect(setup.result.current.view.open?.id).toBe("outfit01");
    act(() => setup.result.current.accept({ t: "lookbook-open", outfitId: null, at: 10 }));
    expect(setup.result.current.view.open?.id).toBe("outfit01");
  });
  it("sends moves and saves one layout after a burst, including remote moves", async () => {
    vi.useFakeTimers();
    const setup = hook();
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    act(() => setup.result.current.view.openOutfit("outfit01"));
    act(() => {
      setup.result.current.view.place({ pieceId: "piece01", x: 0.1, y: 0.1, scale: 1, z: 0 });
      setup.result.current.view.place({ pieceId: "piece01", x: 0.2, y: 0.1, scale: 1, z: 0 });
    });
    expect(setup.send).toHaveBeenCalledWith(expect.objectContaining({ t: "lookbook-place" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(setup.client.updateOutfit).toHaveBeenCalledTimes(1);
    act(() =>
      setup.result.current.accept({
        t: "lookbook-place",
        outfitId: "outfit01",
        pieceId: "piece01",
        place: { x: 0.8, y: 0.1, scale: 1, z: 0 },
        at: 11,
        by: "them",
      }),
    );
    expect(setup.result.current.view.open?.layout[0].x).toBe(0.8);
  });
  it("toggles love and creates the next named outfit before opening it", async () => {
    const setup = hook();
    await waitFor(() => expect(setup.result.current.view.status).toBe("ready"));
    await act(async () => {
      await setup.result.current.view.toggleLove("outfit01");
    });
    expect(setup.client.updateOutfit).toHaveBeenCalledWith("outfit01", {
      love: { by: "me", on: true },
    });
    await act(async () => {
      await setup.result.current.view.createOutfit();
    });
    expect(setup.client.createOutfit).toHaveBeenCalledWith({ name: "Outfit 2", createdBy: "me" });
    expect(setup.result.current.view.open?.id).toBe("outfit02");
  });
});

describe("useLookbook, keeping the board honest", () => {
  const place = { pieceId: "piece01", x: 0.5, y: 0.5, scale: 1, z: 0 };
  const dressed = { ...outfit, layout: [place] };

  it("fills in an outfit the other screen opened before this one had loaded", async () => {
    // Opened by the other screen while this one was still reading the wardrobe.
    // Seeded from nothing, the board looked empty -- and the next move saved
    // that empty board over the real one.
    let finish: (value: unknown) => void = () => {};
    const client = fakeClient();
    client.listOutfits = vi.fn(
      () => new Promise((resolve) => (finish = resolve)),
    ) as unknown as LookbookClient["listOutfits"];
    const setup = hook(client);
    await waitFor(() => expect(client.listOutfits).toHaveBeenCalled());
    act(() => setup.result.current.accept({ t: "lookbook-open", outfitId: "outfit01", at: 11 }));
    await act(async () => finish({ ok: true, value: [dressed] }));
    await waitFor(() => expect(setup.result.current.view.status).toBe("ready"));
    expect(setup.result.current.view.open?.layout).toEqual([place]);
  });

  it("takes a deleted piece off the open board, so the next save is not refused", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const client = fakeClient();
    client.listOutfits = vi.fn(async () => ({ ok: true as const, value: [dressed] }));
    client.deletePiece = vi.fn(async () => ({ ok: true as const, value: true as const }));
    const setup = hook(client);
    await waitFor(() => expect(setup.result.current.view.status).toBe("ready"));
    act(() => setup.result.current.view.openOutfit("outfit01"));
    expect(setup.result.current.view.open?.layout).toEqual([place]);

    await act(async () => void (await setup.result.current.view.deletePiece("piece01")));
    expect(setup.result.current.view.open?.layout).toEqual([]);

    act(() => setup.result.current.view.place({ ...place, pieceId: "piece02", x: 0.2 }));
    await act(async () => void vi.advanceTimersByTime(1100));
    const saved = vi.mocked(client.updateOutfit).mock.calls.at(-1)?.[1];
    expect(saved?.layout?.map((p) => p.pieceId)).toEqual(["piece02"]);
  });
});
