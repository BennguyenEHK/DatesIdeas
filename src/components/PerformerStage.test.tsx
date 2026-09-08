import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PerformerStage } from "./PerformerStage";

vi.mock("./VideoTile", () => ({
  VideoTile: ({
    label,
    size,
    mirrored,
    muted,
    memes,
  }: {
    label: string;
    size: string;
    mirrored: boolean;
    muted: boolean;
    memes: unknown[];
  }) => (
    <div
      aria-label={`${label} video`}
      data-memes={memes.length}
      data-mirrored={mirrored}
      data-muted={muted}
      data-size={size}
    />
  ),
}));

function setup(overrides: Partial<Parameters<typeof PerformerStage>[0]> = {}) {
  const props = {
    performer: null,
    audience: null,
    performerLabel: "You",
    audienceLabel: "Them",
    performerMemes: [],
    audienceMemes: [],
    mediaError: null,
    switches: {
      you: { micOff: false, camOff: false },
      them: { micOff: false, camOff: false },
    },
    ...overrides,
  };
  render(<PerformerStage {...props} />);
  return props;
}

describe("PerformerStage", () => {
  it("makes the performer the full stage tile and keeps the audience in its own column", () => {
    setup();

    expect(screen.getByLabelText("You video").getAttribute("data-size")).toBe("full");
    expect(screen.getByLabelText("Them video").getAttribute("data-size")).toBe("compact");
    expect(screen.getByRole("group", { name: /audience/i })).toBeTruthy();
  });

  it("keeps each reaction list with the face that made it", () => {
    setup({ performerMemes: [{}] as never[], audienceMemes: [{}, {}] as never[] });

    expect(screen.getByLabelText("You video").getAttribute("data-memes")).toBe("1");
    expect(screen.getByLabelText("Them video").getAttribute("data-memes")).toBe("2");
  });

  it("uses the local tile behaviour when you are performing", () => {
    setup();

    expect(screen.getByLabelText("You video").getAttribute("data-mirrored")).toBe("true");
    expect(screen.getByLabelText("You video").getAttribute("data-muted")).toBe("true");
    expect(screen.getByLabelText("Them video").getAttribute("data-mirrored")).toBe("false");
    expect(screen.getByLabelText("Them video").getAttribute("data-muted")).toBe("false");
  });

  it("uses the shared stage geometry rather than an unrelated fixed layout", () => {
    const { container } = render(
      <PerformerStage
        performer={null}
        audience={null}
        performerLabel="You"
        audienceLabel="Them"
        performerMemes={[]}
        audienceMemes={[]}
        mediaError={null}
        switches={{ you: { micOff: false, camOff: false }, them: { micOff: false, camOff: false } }}
      />,
    );

    expect(container.firstElementChild?.getAttribute("style")).toContain("--stage-cols: 3fr 1fr");
    expect(container.firstElementChild?.getAttribute("style")).toContain(
      "--stage-aspect: 2.3703703703703702",
    );
  });
});
