import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryOverlay } from "./MemoryOverlay";
import type { AlbumItem } from "@/lib/album/types";

const photo: AlbumItem = {
  id: "photo-1",
  kind: "photo",
  contentType: "image/jpeg",
  bytes: 1,
  happenedAt: "2026-02-02T12:00:00Z",
  createdAt: "2026-02-02T12:00:00Z",
  caption: "Rooftop dinner",
  loved: false,
  sourceRoom: null,
  url: "https://example.test/photo.jpg",
  posterUrl: null,
};

const video: AlbumItem = {
  ...photo,
  id: "video-1",
  kind: "video",
  contentType: "video/mp4",
  caption: null,
  url: "https://example.test/video.mp4",
  posterUrl: "https://example.test/poster.jpg",
};

afterEach(cleanup);

function renderOverlay(item: AlbumItem = photo) {
  const onClose = vi.fn();
  const onSaveCaption = vi.fn(async () => undefined);
  render(<MemoryOverlay item={item} onClose={onClose} onSaveCaption={onSaveCaption} />);
  return { onClose, onSaveCaption };
}

describe("MemoryOverlay", () => {
  it("shows a photograph as an image, covering the page from the body", () => {
    renderOverlay();
    const dialog = screen.getByRole("dialog", { name: "Memory from February 2, 2026" });
    expect(dialog.closest("body")).toBe(document.body);
    expect(screen.getByRole("img", { name: "Rooftop dinner" }).getAttribute("src")).toBe(photo.url);
    expect(screen.getByText("Rooftop dinner")).toBeTruthy();
  });

  it("shows a moving memory as a video with controls, never autoplaying", () => {
    renderOverlay(video);
    const element = document.querySelector("video");
    expect(element).not.toBeNull();
    expect(element?.hasAttribute("controls")).toBe(true);
    expect(element?.autoplay).toBe(false);
  });

  it("closes with the X, with Escape, and with a click on the dark around it", () => {
    const { onClose } = renderOverlay();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(screen.getByRole("dialog").parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("stays open when the picture itself is clicked", () => {
    const { onClose } = renderOverlay();
    fireEvent.click(screen.getByRole("img", { name: "Rooftop dinner" }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("saves an edited note trimmed, and an emptied note as no note", async () => {
    const { onSaveCaption } = renderOverlay();
    fireEvent.click(screen.getByRole("button", { name: "Edit note" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Note" }), {
      target: { value: "  Stars over the river  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaveCaption).toHaveBeenCalledWith(photo, "Stars over the river"));

    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Note" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Edit note" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Note" }), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaveCaption).toHaveBeenLastCalledWith(photo, null));
  });

  it("cancels the note with Escape without closing the memory", () => {
    const { onClose, onSaveCaption } = renderOverlay(video);
    fireEvent.click(screen.getByRole("button", { name: "Add a note" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Note" }), { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Note" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(onSaveCaption).not.toHaveBeenCalled();
  });
});
