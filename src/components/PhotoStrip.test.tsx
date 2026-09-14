import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { PhotoStrip } from "./PhotoStrip";

function strip(onEdit = vi.fn()) {
  return render(
    <PhotoStrip
      url="blob:strip"
      busy={false}
      onSave={vi.fn()}
      onUpload={async () => ({ ok: true, url: "https://keepsake.test" })}
      hasClip={false}
      clipMimeType={null}
      clipPending={false}
      onDiscard={vi.fn()}
      onEdit={onEdit}
    />,
  );
}

describe("PhotoStrip editing", () => {
  it("offers the accessible edit control only for a completed strip", () => {
    const onEdit = vi.fn();
    const view = strip(onEdit);
    fireEvent.click(view.getByRole("button", { name: "Edit this strip" }));
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it("keeps the edit control absent when no editor was wired", () => {
    const view = render(
      <PhotoStrip
        url="blob:strip"
        busy={false}
        onSave={vi.fn()}
        onUpload={async () => ({ ok: true })}
        hasClip={false}
        clipMimeType={null}
        clipPending={false}
        onDiscard={vi.fn()}
      />,
    );
    expect(view.queryByRole("button", { name: "Edit this strip" })).toBeNull();
  });
});
