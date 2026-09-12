import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordingsGallery } from "./RecordingsGallery";

const mocks = vi.hoisted(() => ({
  addToAlbum: vi.fn(),
  deleteRecording: vi.fn(),
  getRecording: vi.fn(),
  listRecordings: vi.fn(),
  qrDataUrl: vi.fn(),
  setLoved: vi.fn(),
}));

vi.mock("@/lib/recording/store", () => ({
  deleteRecording: mocks.deleteRecording,
  getRecording: mocks.getRecording,
  listRecordings: mocks.listRecordings,
  setLoved: mocks.setLoved,
}));

vi.mock("@/lib/album/upload", () => ({
  addToAlbum: mocks.addToAlbum,
}));

vi.mock("@/lib/photo/qr", () => ({
  qrDataUrl: mocks.qrDataUrl,
  QR_SIZE: 176,
}));

const summary = {
  id: "take",
  room: "r",
  mimeType: "video/webm",
  durationMs: 1200,
  bytes: 4,
  at: 0,
  loved: false,
};

const recording = {
  ...summary,
  blob: new Blob(["clip"], { type: "video/webm" }),
};

async function renderGallery() {
  render(<RecordingsGallery room="r" />);

  return screen.findByLabelText(/Play recording from/);
}

function openMenu() {
  fireEvent.click(screen.getByLabelText(/More options for recording from/));
}

describe("RecordingsGallery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.addToAlbum.mockResolvedValue({
      item: { id: "album-item" },
      ok: true,
    });
    mocks.deleteRecording.mockResolvedValue(true);
    mocks.getRecording.mockResolvedValue(recording);
    mocks.listRecordings.mockResolvedValue([summary]);
    mocks.qrDataUrl.mockResolvedValue("data:image/png;base64,qr");
    mocks.setLoved.mockResolvedValue(true);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({ shareUrl: "https://example.test/share" }),
        ok: true,
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens recording options from both right-click and the visible control", async () => {
    const playButton = await renderGallery();

    fireEvent.contextMenu(playButton);

    expect(screen.getByRole("menu", { name: "Recording options" })).toBeTruthy();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole("menu", { name: "Recording options" })).toBeNull();

    openMenu();

    expect(screen.getByRole("menu", { name: "Recording options" })).toBeTruthy();
  });

  it("requires a second delete press before removing the recording", async () => {
    await renderGallery();
    openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

    expect(mocks.deleteRecording).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("menuitem", { name: "Delete recording" }));

    await waitFor(() => {
      expect(mocks.deleteRecording).toHaveBeenCalledWith("take");
    });
    await waitFor(() => {
      expect(screen.queryByLabelText(/Play recording from/)).toBeNull();
    });
  });

  it("uploads, shares, and renders a QR code in that order", async () => {
    const order: string[] = [];
    mocks.addToAlbum.mockImplementation(async () => {
      order.push("addToAlbum");
      return { item: { id: "album-item" }, ok: true };
    });
    mocks.qrDataUrl.mockImplementation(async (shareUrl: string) => {
      order.push(`qrDataUrl:${shareUrl}`);
      return "data:image/png;base64,qr";
    });
    const fetchMock = vi.fn().mockImplementation(async () => {
      order.push("share POST");
      return {
        json: async () => ({ shareUrl: "https://example.test/share" }),
        ok: true,
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    await renderGallery();
    openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: "Download" }));

    await screen.findByRole("img", {
      name: "QR code linking to https://example.test/share",
    });

    expect(order).toEqual([
      "addToAlbum",
      "share POST",
      "qrDataUrl:https://example.test/share",
    ]);
    expect(fetchMock).toHaveBeenCalledWith("/api/album/album-item/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: "r" }),
    });
  });

  it("shows the server share error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({ error: "Sharing is disabled for this album." }),
        ok: false,
      }),
    );
    await renderGallery();
    openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: "Download" }));

    expect(
      await screen.findByText("Sharing is disabled for this album."),
    ).toBeTruthy();
    expect(mocks.qrDataUrl).not.toHaveBeenCalled();
  });
});
