import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CustomLook, LooksClient } from "./types";
import { useLooks } from "./useLooks";

function look(id: string): CustomLook {
  return {
    id,
    name: `Look ${id}`,
    shots: 2,
    ink: "#ffffff",
    backdropUrl: `https://storage.example/${id}-backdrop.png`,
    overlayUrl: `https://storage.example/${id}-overlay.png`,
    createdAt: "2026-09-13T00:00:00.000Z",
  };
}

function fakeClient(looks: CustomLook[]): LooksClient {
  return {
    list: vi.fn(async () => ({ ok: true as const, looks })),
    save: vi.fn(),
    remove: vi.fn(),
    uploadSource: vi.fn(),
    sourceUrl: vi.fn(),
  };
}

describe("useLooks", () => {
  it("loads nothing and asks for nothing on an unpaired device", () => {
    const client = fakeClient([look("aaaaaa")]);
    const { result } = renderHook(() => useLooks({ paired: false, client }));
    expect(result.current.looks).toEqual([]);
    expect(client.list).not.toHaveBeenCalled();
  });

  it("loads the pair's looks once paired", async () => {
    const client = fakeClient([look("aaaaaa")]);
    const { result } = renderHook(() => useLooks({ paired: true, client }));
    await waitFor(() => expect(result.current.looks.map((item) => item.id)).toEqual(["aaaaaa"]));
  });

  it("shows a just-saved look first, then reloads", async () => {
    const client = fakeClient([look("aaaaaa")]);
    const { result } = renderHook(() => useLooks({ paired: true, client }));
    await waitFor(() => expect(client.list).toHaveBeenCalledTimes(1));

    act(() => result.current.added(look("bbbbbb")));
    expect(result.current.looks[0]?.id).toBe("bbbbbb");
    await waitFor(() => expect(client.list).toHaveBeenCalledTimes(2));
  });
});
