import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Blackout } from "./Blackout";

describe("Blackout", () => {
  it("stays out of the way while the evening is still running", () => {
    for (const phase of ["none", "counting"] as const) {
      const { container } = render(<Blackout phase={phase} />);
      expect(container.firstChild).toBeNull();
    }
  });

  it("covers the room once the picture starts closing", () => {
    const { container } = render(<Blackout phase="closing" />);
    const sheet = container.querySelector("div");
    expect(sheet).not.toBeNull();
    expect(sheet?.className).toContain("fixed");
  });

  it("ENDS BLACK, which is the only part of this that must be true", () => {
    // The animation is decoration: it can be skipped for reduced motion,
    // refused by an engine, or interrupted by a tab going to the background.
    // Where it arrives cannot be any of those things.
    const { container } = render(<Blackout phase="dark" />);
    const sheet = container.querySelector("div");
    expect(sheet?.className).toContain("bg-black");
    expect(sheet?.className).toContain("fixed");
    expect(sheet?.className).toContain("inset-0");
  });

  it("is hidden from a screen reader, having nothing to say", () => {
    const { container } = render(<Blackout phase="dark" />);
    expect(container.querySelector("div")?.getAttribute("aria-hidden")).toBe("true");
  });
});
