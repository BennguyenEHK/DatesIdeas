import { describe, it, expect, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrackDisc } from "./TrackDisc";

/**
 * Reduced motion, kept apart from the rest of TrackDisc's tests.
 *
 * motion/react asks the browser about the preference once and keeps the answer
 * for the life of the module, so a stub installed partway through a file leaks
 * forward into every test after it -- silently, and as a passing test rather
 * than a failing one. A file of its own gets a fresh module, and the preference
 * is set here before anything has had a chance to read it.
 *
 * jsdom has no matchMedia at all, so without this the reduced-motion path is
 * never entered and a test named for it only ever exercises the ordinary one.
 */
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

describe("TrackDisc, for someone who asked for less motion", () => {
  it("holds the record still even while the song plays", () => {
    const { container } = render(
      <TrackDisc state="held" playing title="Song" durationSec={197} />,
    );
    expect(container.querySelector("svg")).toBeTruthy();
    expect(container.querySelector("[data-rotating]")).toBeNull();
  });

  it("still says the song is playing, having given up showing it", () => {
    // Taking the motion away must not take the information with it: whoever
    // cannot see the record turn has to be told in words instead.
    render(<TrackDisc state="held" playing title="Song" durationSec={197} />);
    expect(
      screen.getByRole("img", { hidden: true }).getAttribute("aria-label"),
    ).toMatch(/playing/i);
  });

  it("brightens the label instead, so playing still looks different from paused", () => {
    const playing = render(
      <TrackDisc state="held" playing title="Song" durationSec={197} />,
    );
    const paused = render(
      <TrackDisc state="held" playing={false} title="Song" durationSec={197} />,
    );
    const fill = (result: ReturnType<typeof render>) =>
      result.container.querySelector("[data-label]")?.getAttribute("fill");

    expect(fill(playing)).toBeTruthy();
    expect(fill(paused)).toBeTruthy();
    // The whole point: with rotation gone, the two states must still be
    // distinguishable by something.
    expect(fill(playing)).not.toBe(fill(paused));
  });
});
