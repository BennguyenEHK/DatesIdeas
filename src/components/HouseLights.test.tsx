import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { HouseLights } from "./HouseLights";
import { DIM_DEPTH, DIM_DOWN_MS, DIM_UP_MS } from "@/lib/ui/houseLights";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("style");
});

const dim = () => document.documentElement.style.getPropertyValue("--dim-target");
const speed = () => document.documentElement.style.getPropertyValue("--dim-duration");

describe("HouseLights", () => {
  it("takes the room down while a film is running", () => {
    render(<HouseLights playing />);
    expect(dim()).toBe(String(DIM_DEPTH));
    expect(speed()).toBe(`${DIM_DOWN_MS}ms`);
  });

  it("brings the room back, more slowly than it went down", () => {
    render(<HouseLights playing={false} />);
    expect(dim()).toBe("0");
    expect(speed()).toBe(`${DIM_UP_MS}ms`);
    expect(DIM_UP_MS).toBeGreaterThan(DIM_DOWN_MS);
  });

  it("follows the transport when it changes", () => {
    const { rerender } = render(<HouseLights playing={false} />);
    rerender(<HouseLights playing />);
    expect(dim()).toBe(String(DIM_DEPTH));
    rerender(<HouseLights playing={false} />);
    expect(dim()).toBe("0");
  });

  it("leaves the room lit when movie mode closes", () => {
    // Unmounting mid-film used to be able to strand the page dark. The
    // stylesheet's own default has to come back, not a zero written over it.
    const { unmount } = render(<HouseLights playing />);
    unmount();
    expect(dim()).toBe("");
    expect(speed()).toBe("");
  });

  /**
   * The bug this design exists to make impossible. An overlay covering the
   * room also covered the film, and the film could only stay visible by
   * winning a stacking-context argument against a full-viewport layer that was
   * repainted every frame of the fade. Nothing is rendered here at all, so
   * there is no layer to sit over the picture and nothing for playback to wait
   * on.
   */
  it("renders nothing over the film", () => {
    const { container } = render(<HouseLights playing />);
    expect(container.childNodes).toHaveLength(0);
  });
});
