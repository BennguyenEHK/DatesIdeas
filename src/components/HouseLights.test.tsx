import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { HouseLights } from "./HouseLights";

describe("HouseLights", () => {
  it("renders a scenery layer that cannot intercept room controls", () => {
    render(<HouseLights playing={false} />);

    const layer = screen.getByTestId("house-lights");
    expect(layer.getAttribute("aria-hidden")).toBe("true");
    expect(layer.style.pointerEvents).toBe("");
    expect(layer.style.opacity).toBe("0");
    expect(layer.className).toContain("pointer-events-none");
  });

  it("targets the deliberate cinema depth while playing", () => {
    render(<HouseLights playing />);

    expect(screen.getByTestId("house-lights").style.opacity).toBe("0.72");
  });

  it("sits above the ground and bars, but below the film stage", () => {
    render(<HouseLights playing={false} />);

    const layer = screen.getByTestId("house-lights");
    expect(layer.className).toContain("z-[1]");
    expect(layer.className).toContain("fixed");
  });

  it("does not need a clock loop to hold the final scenery state", () => {
    vi.useFakeTimers();
    render(<HouseLights playing />);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByTestId("house-lights").style.opacity).toBe("0.72");
    vi.useRealTimers();
  });
});
