import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RoomAlbum } from "./RoomAlbum";
import type { AlbumItem } from "@/lib/album/types";
import { civilDate } from "@/lib/album/occasions";

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
    expect(await screen.findByAltText("Older memory")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show February 2, 2026" })).toBeTruthy();
  });

  it("sends a person's thumbnail navigation with the current gear", async () => {
    const { onView } = renderAlbum({ view: { itemId: "older", gear: "days" } });
    await screen.findByAltText("Older memory");
    fireEvent.click(screen.getByRole("button", { name: "Show February 2, 2026" }));
    expect(onView).toHaveBeenCalledWith({ itemId: "newest", gear: "days" });
  });

  it("follows a view received from the other screen without echoing it", async () => {
    const { onView, rerender } = renderAlbum();
    await screen.findByAltText("Older memory");
    rerender(
      <RoomAlbum
        view={{ itemId: "newest", gear: "frames" }}
        revision={0}
        onView={onView}
        onChanged={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(await screen.findByAltText("Newest memory")).toBeTruthy();
    expect(onView).not.toHaveBeenCalled();
  });

  it("fetches again when revision rises", async () => {
    const { rerender } = renderAlbum();
    await screen.findByAltText("Older memory");
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
    await screen.findByAltText("Older memory");
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
    expect(screen.getByAltText("Older memory")).toBeTruthy();
    expect(screen.queryByText("Opening the album…")).toBeNull();
    finish(response());
    expect(await screen.findByAltText("Older memory")).toBeTruthy();
  });

  it("moves to the next thumbnail in the strip with the arrow key", async () => {
    const { onView } = renderAlbum({ view: { itemId: "newest", gear: "frames" } });
    await screen.findByAltText("Newest memory");
    fireEvent.keyDown(screen.getByRole("region", { name: "Shared album" }), { key: "ArrowRight" });
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
    await screen.findByAltText("Newest memory");
    const stack = screen.getByRole("option", { name: /2 memories/ });
    fireEvent.click(stack);
    // The top of the stack is the newest memory of that day.
    expect(onView).toHaveBeenCalledWith({ itemId: "older-2", gear: "days" });
  });

  it("starts the day's film for both screens, anchored ahead on the shared clock", async () => {
    const sameDay = {
      ...ITEMS[1],
      id: "older-2",
      caption: "Also that day",
      happenedAt: "2026-02-01T15:00:00Z",
    };
    fetchMock.mockResolvedValue(response(200, [...ITEMS, sameDay]));
    const onFilm = vi.fn();
    renderAlbum({ onFilm, now: () => 10_000, filmLeadMs: 300 });
    await screen.findByAltText("Older memory");
    fireEvent.click(screen.getByRole("button", { name: "▶ Play this day" }));
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(onFilm).toHaveBeenCalledWith({
      day: civilDate("2026-02-01T12:00:00Z", zone),
      anchorMs: 10_300,
      pausedAtMs: null,
    });
  });

  it("offers no film for a day with a single memory", async () => {
    renderAlbum({ onFilm: vi.fn() });
    await screen.findByAltText("Older memory");
    expect(screen.queryByRole("button", { name: "▶ Play this day" })).toBeNull();
  });

  it("plays a shared film inside the album and closes it for both screens", async () => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    const sameDay = {
      ...ITEMS[1],
      id: "older-2",
      caption: "Also that day",
      happenedAt: "2026-02-01T15:00:00Z",
    };
    fetchMock.mockResolvedValue(response(200, [...ITEMS, sameDay]));
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const onFilm = vi.fn();
    renderAlbum({
      film: { day: civilDate("2026-02-01T12:00:00Z", zone), anchorMs: 0, pausedAtMs: 0 },
      onFilm,
      now: () => 0,
    });
    expect(await screen.findByRole("dialog", { name: "Play the day" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "CLOSE" }));
    expect(onFilm).toHaveBeenCalledWith(null);
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
    await screen.findByAltText("Older memory");
    fireEvent.click(screen.getByRole("button", { name: "Love memory" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/album/older",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ loved: true }) }),
    );
  });

  it("does not notify the other screen when a love PATCH fails", async () => {
    fetchMock
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(new Response(null, { status: 500 }));
    const { onChanged } = renderAlbum();
    await screen.findByAltText("Older memory");
    fireEvent.click(screen.getByRole("button", { name: "Love memory" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("did not save"));
    expect(onChanged).not.toHaveBeenCalled();
  });
});
