import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
