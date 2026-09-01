import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemeOverlay } from "./MemeOverlay";
import { MEME_IDS } from "@/lib/rtc/protocol";

/**
 * The emoji map is keyed by MemeId, so TypeScript already refuses a missing
 * entry. What it cannot catch is an entry whose value is empty or whitespace,
 * which would render an invisible reaction — the gesture fires, both screens
 * agree, and nothing appears. That failure looks exactly like a broken
 * detector, so it is worth a test of its own.
 */
describe("MemeOverlay", () => {
  it("renders a visible glyph for every gesture", () => {
    for (const id of MEME_IDS) {
      const { unmount } = render(<MemeOverlay memes={[{ key: 1, id }]} />);
      const text = document.body.textContent ?? "";
      expect(text.trim(), `no glyph rendered for "${id}"`).not.toBe("");
      unmount();
    }
  });

  it("renders nothing when there are no memes", () => {
    render(<MemeOverlay memes={[]} />);
    expect((document.body.textContent ?? "").trim()).toBe("");
  });

  it("renders every active meme at once", () => {
    render(
      <MemeOverlay
        memes={[
          { key: 1, id: "heart" },
          { key: 2, id: "wink" },
        ]}
      />,
    );
    expect(screen.getByText("💖")).toBeDefined();
    expect(screen.getByText("😉")).toBeDefined();
  });
});
