import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { PhotoStrip } from "./PhotoStrip";

function strip(onEdit = vi.fn(), size?: "column" | "wide") {
  return render(
    <PhotoStrip
      size={size}
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

describe("a wide strip", () => {
  it("is held to the booth frame, so the buttons beside it stay on screen", () => {
    const image = strip(vi.fn(), "wide").getByRole("img");
    expect(image.className).toContain("h-full");
    expect(image.className).toContain("min-w-0");
  });

  it("keeps the column strip's own sizing", () => {
    const image = strip(vi.fn(), "column").getByRole("img");
    expect(image.className).toContain("max-w-full");
    expect(image.className).not.toContain("h-full");
  });
});
