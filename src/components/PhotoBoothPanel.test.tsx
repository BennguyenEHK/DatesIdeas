import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { PhotoBoothPanel } from "./PhotoBoothPanel";

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal("ResizeObserver", NoopResizeObserver);

const look = {
  id: "flower01",
  name: "Flower hour",
  shots: 3 as const,
  ink: "#ffffff",
  backdropUrl: "/paper.png",
  overlayUrl: "/marks.png",
  createdAt: "2026-09-13T00:00:00.000Z",
};

describe("PhotoBoothPanel", () => {
  it("offers all four shot choices in plain language", () => {
    const view = render(
      <PhotoBoothPanel
        themeId="griffith"
        onTheme={vi.fn()}
        shots={2}
        onShots={vi.fn()}
        onStart={vi.fn()}
        running={false}
        ready
      />,
    );
    expect([1, 2, 3, 4].map((count) => view.getByRole("radio", { name: `${count} shots` }))).toHaveLength(4);
  });

  it("adds designed looks, locks their count, and clears one when a theme is picked", () => {
    const onLook = vi.fn();
    const onTheme = vi.fn();
    const onShots = vi.fn();
    const onDesignLook = vi.fn();
    const view = render(
      <PhotoBoothPanel
        themeId="rose"
        onTheme={onTheme}
        shots={3}
        onShots={onShots}
        onStart={vi.fn()}
        running={false}
        ready
        looks={[look]}
        lookId={look.id}
        onLook={onLook}
        onDesignLook={onDesignLook}
      />,
    );
    expect(view.getByRole("radio", { name: "Flower hour" })).toBeTruthy();
    expect(view.getByRole("radio", { name: "1 shots" }).getAttribute("disabled")).not.toBeNull();
    expect(view.getByRole("radio", { name: "1 shots" }).getAttribute("title")).toContain("3 shots");
    fireEvent.click(view.getByRole("radio", { name: "Neon" }));
    expect(onLook).toHaveBeenCalledWith(null);
    expect(onTheme).toHaveBeenCalledWith("neon");
    fireEvent.click(view.getByRole("button", { name: "Design a look" }));
    expect(onDesignLook).toHaveBeenCalledOnce();
  });
});
