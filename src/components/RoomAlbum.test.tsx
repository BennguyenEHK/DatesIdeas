import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RoomAlbum } from "./RoomAlbum";
import type { AlbumItem } from "@/lib/album/types";

const ITEMS: AlbumItem[] = [
  {
    id: "newest",
    kind: "photo",
    contentType: "image/jpeg",
    bytes: 1,
    happenedAt: "2026-02-02T12:00:00Z",
    createdAt: "2026-02-02T12:00:00Z",
    caption: "Newest memory",
    loved: false,
    sourceRoom: null,
    url: "https://example.test/newest.jpg",
    posterUrl: null,
  },
  {
    id: "older",
    kind: "photo",
    contentType: "image/jpeg",
    bytes: 1,
    happenedAt: "2026-02-01T12:00:00Z",
    createdAt: "2026-02-01T12:00:00Z",
    caption: "Older memory",
    loved: false,
    sourceRoom: null,
    url: "https://example.test/older.jpg",
    posterUrl: null,
  },
];

const fetchMock = vi.fn<typeof fetch>();

function response(status = 200, items = ITEMS): Response {
  return new Response(JSON.stringify({ items, occasions: [], cursor: null }), { status });
}

function renderAlbum(overrides: Partial<React.ComponentProps<typeof RoomAlbum>> = {}) {
  const onView = vi.fn();
  const onChanged = vi.fn();
  const onClose = vi.fn();
  const result = render(
    <RoomAlbum
      view={{ itemId: "older", gear: "frames" }}
      revision={0}
      onView={onView}
      onChanged={onChanged}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { ...result, onView, onChanged, onClose };
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  Element.prototype.scrollIntoView = vi.fn();
  fetchMock.mockResolvedValue(response());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("RoomAlbum", () => {
  it("renders loaded items and follows view.itemId", async () => {
    renderAlbum();
    expect(await screen.findByRole("region", { name: "Memory sky" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Show February 2, 2026" })).not.toHaveLength(0);
  });

  it("sends a person's thumbnail navigation with the current gear", async () => {
    const { onView } = renderAlbum({ view: { itemId: "older", gear: "days" } });
    await screen.findByRole("region", { name: "Memory sky" });
    fireEvent.click(screen.getAllByRole("button", { name: "Show February 2, 2026" })[0]);
    expect(onView).toHaveBeenCalledWith({ itemId: "newest", gear: "days" });
  });

  it("follows a view received from the other screen without echoing it", async () => {
    const { onView, rerender } = renderAlbum();
    await screen.findByRole("region", { name: "Memory sky" });
    rerender(
      <RoomAlbum
        view={{ itemId: "newest", gear: "frames" }}
        revision={0}
        onView={onView}
        onChanged={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(await screen.findByRole("region", { name: "Memory sky" })).toBeTruthy();
    expect(onView).not.toHaveBeenCalled();
  });

  it("fetches again when revision rises", async () => {
    const { rerender } = renderAlbum();
    await screen.findByRole("region", { name: "Memory sky" });
    rerender(
      <RoomAlbum
        view={{ itemId: "older", gear: "frames" }}
        revision={1}
        onView={vi.fn()}
        onChanged={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("keeps the photograph on screen while it reloads for the other screen's change", async () => {
    // K loving a photograph must not blank this screen or restart a video.
    const { rerender } = renderAlbum();
    await screen.findByRole("region", { name: "Memory sky" });
    let finish: (value: Response) => void = () => undefined;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (finish = resolve)));
    rerender(
      <RoomAlbum
        view={{ itemId: "older", gear: "frames" }}
        revision={1}
        onView={vi.fn()}
        onChanged={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("region", { name: "Memory sky" })).toBeTruthy();
    expect(screen.queryByText("Opening the album…")).toBeNull();
    finish(response());
    expect(await screen.findByRole("region", { name: "Memory sky" })).toBeTruthy();
  });

  it("moves to the next lantern in the sky with the arrow key", async () => {
    const { onView } = renderAlbum({ view: { itemId: "newest", gear: "frames" } });
    await screen.findByRole("region", { name: "Memory sky" });
    fireEvent.keyDown(screen.getByRole("region", { name: "Memory sky" }), { key: "ArrowRight" });
    expect(onView).toHaveBeenCalledWith({ itemId: "older", gear: "frames" });
  });

  it("draws a day with several memories as a stack in the days gear", async () => {
    const sameDay = {
      ...ITEMS[1],
      id: "older-2",
      caption: "Also that day",
      happenedAt: "2026-02-01T15:00:00Z",
    };
    fetchMock.mockResolvedValue(response(200, [...ITEMS, sameDay]));
    const { onView } = renderAlbum({ view: { itemId: "newest", gear: "days" } });
    await screen.findByRole("region", { name: "Memory sky" });
    const stack = screen.getByRole("option", { name: /2 memories/ });
    fireEvent.click(stack);
    // The top of the stack is the newest memory of that day.
    expect(onView).toHaveBeenCalledWith({ itemId: "older-2", gear: "days" });
  });

  it("keeps the call available when this device is not paired", async () => {
    fetchMock.mockResolvedValueOnce(response(401));
    const { onClose } = renderAlbum();
    expect(await screen.findByText("This device isn't on your album yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to the call" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("only notifies the other screen after a love PATCH succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const { onChanged } = renderAlbum();
    await screen.findByRole("region", { name: "Memory sky" });
    fireEvent.click(screen.getByRole("button", { name: "Love memory" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/album/older",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ loved: true }) }),
    );
  });

  it("opens the centre lantern up close on this screen and saves its note for both", async () => {
    fetchMock
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const { onChanged, onView } = renderAlbum();
    await screen.findByRole("region", { name: "Memory sky" });

    fireEvent.click(screen.getByRole("button", { name: "Open this memory" }));
    expect(screen.getByRole("dialog", { name: "Memory from February 1, 2026" })).toBeTruthy();
    expect(onView).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Edit note" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Note" }), { target: { value: "First picnic" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/album/older",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ caption: "First picnic" }) }),
    );
    // The lantern's own paper tag shows the same note.
    expect(screen.getAllByText("First picnic").length).toBeGreaterThan(1);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not notify the other screen when a love PATCH fails", async () => {
    fetchMock
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(new Response(null, { status: 500 }));
    const { onChanged } = renderAlbum();
    await screen.findByRole("region", { name: "Memory sky" });
    fireEvent.click(screen.getByRole("button", { name: "Love memory" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("did not save"));
    expect(onChanged).not.toHaveBeenCalled();
  });
});
