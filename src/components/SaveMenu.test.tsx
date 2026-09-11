import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SaveMenu } from "./SaveMenu";

function open(options: {
  hasClip?: boolean;
  clipMimeType?: string | null;
  clipPending?: boolean;
}) {
  const view = render(
    <SaveMenu
      onDownload={vi.fn()}
      onUpload={vi.fn(async () => ({ ok: true, url: "https://example/k/abc" }))}
      hasClip={options.hasClip ?? true}
      clipMimeType={options.clipMimeType ?? "video/mp4;codecs=avc1.42E01E"}
      clipPending={options.clipPending ?? false}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /save/i }));
  return view;
}

afterEach(() => vi.restoreAllMocks());

describe("what the live-strip choice admits to", () => {
  it("warns before a QR is made when the clip is WebM", () => {
    open({ clipMimeType: "video/webm;codecs=vp9" });
    // The point of doing this here rather than on the phone: a QR is a promise
    // that somebody walks across the room to keep.
    expect(screen.getByText(/phone’s photos won’t take it/i)).toBeTruthy();
  });

  it("says nothing of the sort for an MP4 clip", () => {
    open({ clipMimeType: "video/mp4" });
    expect(screen.queryByText(/won’t take it/i)).toBeNull();
    expect(screen.getByText(/The moving version/i)).toBeTruthy();
  });

  it("reports an absent live photo rather than a format problem", () => {
    open({ hasClip: false, clipMimeType: null });
    expect(screen.getByText(/No live photo from this sitting/i)).toBeTruthy();
    expect(screen.queryByText(/won’t take it/i)).toBeNull();
  });

  it("reports stitching in progress ahead of the format", () => {
    open({ clipPending: true, clipMimeType: "video/webm" });
    expect(screen.getByText(/Still stitching/i)).toBeTruthy();
    expect(screen.queryByText(/won’t take it/i)).toBeNull();
  });

  it("still offers the WebM strip, because it is a real file on a computer", () => {
    open({ clipMimeType: "video/webm" });
    const item = screen.getByRole("menuitem", { name: /live strip/i });
    expect(item.hasAttribute("disabled")).toBe(false);
  });

  it("leaves the other two choices alone", () => {
    open({ clipMimeType: "video/webm" });
    expect(screen.getByText(/Stays here. Nothing is uploaded./i)).toBeTruthy();
    expect(screen.getByText(/Uploads the strip so a phone can scan it./i)).toBeTruthy();
  });
});

describe("keeping a strip in the album", () => {
  afterEach(cleanup);

  function openWith(options: { canKeep: boolean; onKeep?: () => Promise<{ ok: boolean; error?: string }> }) {
    const onKeep = vi.fn(options.onKeep ?? (async () => ({ ok: true })));
    render(
      <SaveMenu
        onDownload={vi.fn()}
        onUpload={vi.fn(async () => ({ ok: true, url: "https://example/k/abc" }))}
        onKeep={onKeep}
        canKeep={options.canKeep}
        hasClip={false}
        clipMimeType={null}
        clipPending={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    return onKeep;
  }

  it("is not offered to a browser with no season ticket", () => {
    // Offering it and failing on press would be worse than not offering it:
    // the person has no way to act on "you are not paired" from inside a room.
    openWith({ canKeep: false });
    expect(screen.queryByRole("menuitem", { name: /Keep in the album/i })).toBeNull();
    expect(screen.getByRole("menuitem", { name: /Save to this computer/i })).toBeTruthy();
  });

  it("is offered first to a paired browser, because it needs no phone", () => {
    openWith({ canKeep: true });
    const items = screen.getAllByRole("menuitem");
    expect(items[0].textContent).toMatch(/Keep in the album/i);
  });

  it("saves the strip and says where it went", async () => {
    const onKeep = openWith({ canKeep: true });
    fireEvent.click(screen.getByRole("menuitem", { name: /Keep in the album/i }));
    await waitFor(() => expect(onKeep).toHaveBeenCalledWith("strip"));
    await waitFor(() => expect(screen.getByText(/on the reel now/i)).toBeTruthy());
  });

  it("shows the reason when it does not save, rather than claiming it did", async () => {
    const onKeep = openWith({
      canKeep: true,
      onKeep: async () => ({ ok: false, error: "this device is not paired yet" }),
    });
    fireEvent.click(screen.getByRole("menuitem", { name: /Keep in the album/i }));
    await waitFor(() => expect(onKeep).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/not paired yet/i)).toBeTruthy());
    expect(screen.queryByText(/on the reel now/i)).toBeNull();
  });

  it("saves the moving version when the sitting made one", async () => {
    const onKeep = vi.fn(async () => ({ ok: true }));
    render(
      <SaveMenu
        onDownload={vi.fn()}
        onUpload={vi.fn(async () => ({ ok: true, url: "u" }))}
        onKeep={onKeep}
        canKeep
        hasClip
        clipMimeType="video/mp4"
        clipPending={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Keep in the album/i }));
    await waitFor(() => expect(onKeep).toHaveBeenCalledWith("clip"));
  });
});
