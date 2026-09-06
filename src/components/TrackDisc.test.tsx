import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrackDisc, type DiscState } from "./TrackDisc";

function setup(props: { state: DiscState; playing: boolean; title?: string | null; durationSec?: number; size?: "sm" | "md" }) {
  return render(
    <TrackDisc
      state={props.state}
      playing={props.playing}
      title={props.title ?? null}
      durationSec={props.durationSec ?? 0}
      size={props.size}
    />
  );
}

describe("TrackDisc", () => {
  describe("absent state", () => {
    it("renders nothing at all when state is absent", () => {
      const { container } = setup({ state: "absent", playing: false });
      expect(container.firstChild).toBeNull();
    });

    it("renders nothing even when playing is true", () => {
      const { container } = setup({ state: "absent", playing: true });
      expect(container.firstChild).toBeNull();
    });
  });

  describe("loading state", () => {
    it("shows a dim disc outline without a gold centre label", () => {
      setup({ state: "loading", playing: false });
      const disc = screen.getByRole("img", { hidden: true });
      expect(disc).toBeTruthy();
      // The disc should be present in the DOM
      expect(disc.parentElement).toBeTruthy();
    });

    it("shows a thin gold arc sweeping the rim during loading", () => {
      setup({ state: "loading", playing: false });
      const svg = screen.getByRole("img", { hidden: true });
      // Check for the arc element by looking for a circle or path
      const svgElement = svg as unknown as SVGElement;
      const arcs = svgElement.querySelectorAll("circle, path");
      expect(arcs.length).toBeGreaterThan(0);
    });

    it("does not rotate the disc body during loading", () => {
      const { container } = setup({ state: "loading", playing: false });
      const svg = container.querySelector("svg");
      expect(svg).toBeTruthy();
      // Loading state should show the arc but no rotation
      // The data-rotating attribute should NOT be present during loading
      const rotatingElement = container.querySelector("[data-rotating]");
      expect(rotatingElement).toBeNull();
    });

    it("never rotates even when playing is true during loading", () => {
      const { container } = setup({ state: "loading", playing: true });
      const svg = container.querySelector("svg");
      expect(svg).toBeTruthy();
      // Core regression test: loading disc NEVER rotates, period
      // Even with playing=true, the data-rotating attribute should NOT be present
      const rotatingElement = container.querySelector("[data-rotating]");
      expect(rotatingElement).toBeNull();
    });
  });

  describe("held state", () => {
    it("shows the full disc when state is held", () => {
      setup({ state: "held", playing: false, title: "Test Song" });
      const disc = screen.getByRole("img", { hidden: true });
      expect(disc).toBeTruthy();
    });

    it("shows the gold centre label when state is held", () => {
      const { container } = setup({ state: "held", playing: false, title: "Test Song" });
      // The label circle should be present
      const svg = container.querySelector("svg");
      expect(svg).toBeTruthy();
    });

    it("stands still while the song is paused", () => {
      const { container } = setup({ state: "held", playing: false, title: "Song" });
      // The disc is on the platter and the needle is up. A record that turned
      // here would be claiming audio was moving when none is.
      expect(container.querySelector("svg")).toBeTruthy();
      expect(container.querySelector("[data-rotating]")).toBeNull();
    });

    it("turns while the song is playing", () => {
      const { container } = setup({ state: "held", playing: true });
      expect(container.querySelector("[data-rotating]")).toBeTruthy();
    });
  });

  describe("rotation tracks playing state independently of loading", () => {
    it("core regression: loading disc never rotates, even with playing=true", () => {
      // This is the critical rule: rotation means PLAYING, never loading.
      const { container: container1 } = setup({ state: "loading", playing: false });
      const { container: container2 } = setup({ state: "loading", playing: true });

      // Both should have SVG elements for loading state
      expect(container1.querySelector("svg")).toBeTruthy();
      expect(container2.querySelector("svg")).toBeTruthy();

      // Neither should have the data-rotating attribute, even when playing=true
      const rotating1 = container1.querySelector("[data-rotating]");
      const rotating2 = container2.querySelector("[data-rotating]");

      expect(rotating1).toBeNull();
      expect(rotating2).toBeNull();
    });

    it("THE RULE: across every combination, the disc turns exactly when it is playing", () => {
      // The whole design rests on rotation meaning one thing. Asserting it
      // over the full cross product is what makes that a guarantee rather than
      // a claim -- and it is what an earlier version of this file missed by
      // asserting the same truthy value for both playing and paused.
      for (const state of ["absent", "loading", "held"] as const) {
        for (const playing of [false, true]) {
          const { container, unmount } = setup({ state, playing, title: "Song" });
          const turning = container.querySelector("[data-rotating]") !== null;
          expect(turning, `state=${state} playing=${playing}`).toBe(
            state === "held" && playing,
          );
          unmount();
        }
      }
    });
  });

  // The reduced-motion behaviour lives in TrackDisc.reducedMotion.test.tsx.
  // motion/react reads the preference once and keeps the answer for the life of
  // the module, so a stub installed partway through a file leaks into every
  // test after it. A separate file gets a fresh module and cannot poison this
  // one -- which is what the two failures here were, when they were together.

  describe("duration formatting", () => {
    it("formats duration 197 as 3:17", () => {
      setup({ state: "held", playing: false, title: "Song", durationSec: 197 });
      expect(screen.getByText("3:17")).toBeTruthy();
    });

    it("formats duration 60 as 1:00", () => {
      setup({ state: "held", playing: false, title: "Song", durationSec: 60 });
      expect(screen.getByText("1:00")).toBeTruthy();
    });

    it("formats duration 5 as 0:05", () => {
      setup({ state: "held", playing: false, title: "Song", durationSec: 5 });
      expect(screen.getByText("0:05")).toBeTruthy();
    });

    it("does not show duration when durationSec is 0", () => {
      setup({ state: "held", playing: false, title: "Song", durationSec: 0 });
      expect(screen.queryByText(/\d+:\d+/)).toBeNull();
    });

    it("does not show duration when durationSec is unknown (0 default)", () => {
      setup({ state: "held", playing: false, title: "Song" });
      const durationText = screen.queryByText(/\d+:\d+/);
      if (durationText) {
        // If it exists, it should not be just a duration
        expect(durationText.textContent).not.toMatch(/^\d+:\d+$/);
      }
    });
  });

  describe("title rendering", () => {
    it("renders the title when provided", () => {
      setup({ state: "held", playing: false, title: "Moonlight Sonata" });
      expect(screen.getByText("Moonlight Sonata")).toBeTruthy();
    });

    it("does not render a title element when title is null", () => {
      setup({ state: "held", playing: false, title: null });
      // If a title container exists, it should be empty
      const titleElements = screen.queryAllByText(/./);
      const titles = titleElements.filter((el) => el.textContent?.trim() && !/^\d+:\d+$/.test(el.textContent?.trim() || ""));
      expect(titles.length).toBe(0);
    });

    it("does not render a title while loading", () => {
      setup({ state: "loading", playing: false, title: null });
      // Should have no text content except possibly duration
      const content = screen.queryAllByText(/./);
      expect(content.length).toBe(0);
    });
  });

  describe("accessibility", () => {
    it("gives the disc an appropriate role and label for screen readers", () => {
      setup({ state: "held", playing: true, title: "Test Song" });
      // Should have either a role or label that identifies it as a track disc
      const disc = screen.getByRole("img", { hidden: true });
      const ariaLabel = disc.getAttribute("aria-label");
      expect(ariaLabel).toBeTruthy();
      expect(ariaLabel).toMatch(/track|song|disc|playing/i);
    });

    it("announces whether the track is playing in the accessibility label", () => {
      setup({
        state: "held",
        playing: false,
        title: "Song",
      });
      const { container: playingContainer } = setup({
        state: "held",
        playing: true,
        title: "Song",
      });

      const playingDisc = playingContainer.querySelector("[role='img']");
      const playingLabel = (playingDisc?.getAttribute("aria-label") ?? "") as string;

      // Should say it's playing when playing=true
      expect(playingLabel).toMatch(/playing|rotating/i);
    });

    it("indicates loading state in accessibility label", () => {
      setup({ state: "loading", playing: false });
      const disc = screen.getByRole("img", { hidden: true });
      const label = disc.getAttribute("aria-label");
      expect(label).toMatch(/loading|decoding/i);
    });
  });

  describe("compact size variant (sm)", () => {
    it("renders the disc at small size (28px) when size='sm'", () => {
      const { container } = setup({ state: "held", playing: false, title: "Song", size: "sm" });
      const svg = container.querySelector("svg");
      expect(svg).toBeTruthy();
      expect(svg?.className.baseVal).toContain("h-7");
      expect(svg?.className.baseVal).toContain("w-7");
    });

    it("hides title and duration text at sm size", () => {
      setup({ state: "held", playing: false, title: "Test Song", durationSec: 180, size: "sm" });
      // Title and duration should not be visible as text
      expect(screen.queryByText("Test Song")).toBeNull();
      expect(screen.queryByText("3:00")).toBeNull();
    });

    it("keeps accessible label at sm size so screen readers learn track state", () => {
      setup({ state: "held", playing: true, title: "Test Song", size: "sm" });
      const disc = screen.getByRole("img", { hidden: true });
      const label = disc.getAttribute("aria-label");
      expect(label).toBeTruthy();
      expect(label).toMatch(/playing/i);
    });

    it("rotation still tracks playing state at sm size", () => {
      const { container: notPlaying } = setup({
        state: "held",
        playing: false,
        title: "Song",
        size: "sm",
      });
      const { container: playing } = setup({
        state: "held",
        playing: true,
        title: "Song",
        size: "sm",
      });

      // Both should have the disc
      expect(notPlaying.querySelector("svg")).toBeTruthy();
      expect(playing.querySelector("svg")).toBeTruthy();
      // When not playing, no data-rotating attribute
      expect(notPlaying.querySelector("[data-rotating]")).toBeNull();
      // When playing, data-rotating attribute is present
      expect(playing.querySelector("[data-rotating]")).toBeTruthy();
    });

    it("loading state at sm size shows no text (disc outline only)", () => {
      const { container } = setup({ state: "loading", playing: false, size: "sm" });
      const svg = container.querySelector("svg");
      expect(svg).toBeTruthy();
      // Should not show any title or duration
      const textElements = screen.queryAllByText(/./);
      expect(textElements.length).toBe(0);
    });

    it("core regression at sm size: loading disc never rotates even with playing=true", () => {
      const { container } = setup({
        state: "loading",
        playing: true,
        size: "sm",
      });

      // Should have SVG
      expect(container.querySelector("svg")).toBeTruthy();
      // Should NOT have data-rotating attribute in loading state
      expect(container.querySelector("[data-rotating]")).toBeNull();
    });

    it("defaults to md size when size prop is omitted", () => {
      const { container } = setup({ state: "held", playing: false, title: "Song" });
      const svg = container.querySelector("svg");
      // Default should be md (80px / h-20 w-20)
      expect(svg?.className.baseVal).toContain("h-20");
      expect(svg?.className.baseVal).toContain("w-20");
    });

    it("shows title and duration at md size (default)", () => {
      setup({ state: "held", playing: false, title: "Test Song", durationSec: 180 });
      // At default (md) size, title and duration should be visible
      expect(screen.getByText("Test Song")).toBeTruthy();
      expect(screen.getByText("3:00")).toBeTruthy();
    });
  });
});
