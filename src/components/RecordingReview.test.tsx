import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordingReview } from "./RecordingReview";

const recording = {
  blob: new Blob(["clip"], { type: "video/webm" }),
  mimeType: "video/webm",
  durationMs: 1000,
};

function renderReview(onDiscard = vi.fn()) {
  const onLove = vi.fn();
  const onSave = vi.fn();
  const view = render(
    <RecordingReview
      recording={recording}
      onSave={onSave}
      onLove={onLove}
      onDiscard={onDiscard}
    />,
  );

  return { onDiscard, onLove, onSave, view };
}

describe("RecordingReview", () => {
  const createObjectURL = vi.fn();
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    createObjectURL.mockReturnValue("blob:clip");
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends save, love, and confirmed delete to their own handlers", () => {
    const { onDiscard, onLove, onSave } = renderReview();

    fireEvent.click(screen.getByText("Save"));
    fireEvent.click(screen.getByRole("button", { name: "Love this recording" }));
    fireEvent.click(screen.getByText("Delete"));

    expect(onDiscard).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Delete recording"));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onLove).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("discards when Escape is pressed", () => {
    const onDiscard = vi.fn();
    renderReview(onDiscard);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("releases the video object URL when unmounted", () => {
    const { view } = renderReview();

    view.unmount();

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:clip");
  });
});
