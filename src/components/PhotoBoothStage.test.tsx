import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { createRef } from "react";
import { PhotoBoothStage } from "./PhotoBoothStage";
import { theme } from "@/lib/photo/themes";

// jsdom has no ResizeObserver. The scene painter watches its own size and
// bails when there is no 2d context, so an inert stub is enough to render.
class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal("ResizeObserver", NoopResizeObserver);

function stage(props: {
  count?: number | null;
  flashing?: boolean;
  review?: { shotIndex: number; frame: { canvas: HTMLCanvasElement } | null } | null;
}) {
  return render(
    <PhotoBoothStage
      theme={theme("griffith")}
      local={null}
      remote={null}
      localMemes={[]}
      remoteMemes={[]}
      count={props.count ?? null}
      flashing={props.flashing ?? false}
      review={props.review ?? null}
      shots={4}
      localVideoRef={createRef<HTMLVideoElement>()}
      remoteVideoRef={createRef<HTMLVideoElement>()}
      filmCanvasRef={createRef<HTMLCanvasElement>()}
    >
      <div>strip</div>
    </PhotoBoothStage>,
  );
}

/** The white overlay. It has no semantics, so it is found by what it looks like. */
const flash = (c: HTMLElement) => c.querySelector(".bg-white");

describe("the booth flash", () => {
  it("shows nothing when no photograph is being taken", () => {
    const { container } = stage({});
    expect(flash(container)).toBeNull();
  });

  it("whites out the frame at the moment of capture", () => {
    const { container } = stage({ flashing: true });
    expect(flash(container)).not.toBeNull();
  });

  /**
   * The bug this exists to prevent, and it hid the flash completely.
   *
   * The timeline schedules the flash and the review at the SAME instant, so
   * React renders them in one pass. The overlay used to be gated on
   * `review === null`, which is therefore false at exactly the moment the
   * flash exists -- so a shot was taken with no sign that anything happened.
   */
  it("fires over the review, which arrives on the very same instant", () => {
    const { container } = stage({
      flashing: true,
      review: { shotIndex: 0, frame: null },
    });
    expect(flash(container)).not.toBeNull();
  });

  it("stops once the flash is over, even while the review is still up", () => {
    const { container } = stage({
      flashing: false,
      review: { shotIndex: 0, frame: null },
    });
    expect(flash(container)).toBeNull();
  });

  it("sits above the review rather than behind it", () => {
    const { container } = stage({
      flashing: true,
      review: { shotIndex: 0, frame: null },
    });
    expect(flash(container)?.className).toContain("z-10");
  });

  it("hides the countdown while a photograph is being reviewed", () => {
    const { queryByText } = stage({ count: 5, review: { shotIndex: 0, frame: null } });
    expect(queryByText("5")).toBeNull();
  });

  it("shows the countdown when nothing is being reviewed", () => {
    const { getByText } = stage({ count: 5 });
    expect(getByText("5")).toBeTruthy();
  });
});
