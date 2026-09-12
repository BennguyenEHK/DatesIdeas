import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { expand, type BlockSeed } from "@/lib/calendar/recur";
import { CalendarWeek } from "./CalendarWeek";

const start = new Date("2026-03-02T00:00:00.000Z");
const until = new Date("2026-03-09T00:00:00.000Z");

function block(overrides: Partial<BlockSeed> = {}): BlockSeed {
  return {
    id: "block-1",
    title: "Dinner",
    startsAt: "2026-03-04T09:00:00.000Z",
    endsAt: "2026-03-04T10:00:00.000Z",
    zone: "UTC",
    repeat: "none",
    repeatUntil: null,
    ...overrides,
  };
}

function renderWeek(blocks: BlockSeed[], onCreate = vi.fn(), onEdit = vi.fn()) {
  const occurrences = expand(blocks, start, until, "UTC");
  render(
    <CalendarWeek
      start={start}
      viewerZone="UTC"
      companionZone="Asia/Ho_Chi_Minh"
      todayDate="2026-03-04"
      occurrences={occurrences}
      blocks={
        new Map(
          blocks.map((item) => [
            item.id,
            { title: item.title, owner: "both" },
          ]),
        )
      }
      onCreate={onCreate}
      onEdit={onEdit}
    />,
  );
  return { onCreate, onEdit };
}

describe("CalendarWeek", () => {
  it("opens an existing block and makes an empty day reachable", () => {
    const { onCreate, onEdit } = renderWeek([block()]);

    fireEvent.click(screen.getByRole("button", { name: /edit dinner/i }));
    fireEvent.keyDown(screen.getByRole("button", { name: /add a block on mon 2/i }), {
      key: "Enter",
    });

    expect(onEdit).toHaveBeenCalledWith("block-1");
    expect(onCreate).toHaveBeenCalledWith("2026-03-02", 9);
    expect(screen.getAllByText(/there$/i)).toHaveLength(7);
  });

  it("draws an overnight block in every day it crosses", () => {
    renderWeek([
      block({
        title: "Late movie",
        startsAt: "2026-03-04T23:00:00.000Z",
        endsAt: "2026-03-05T01:00:00.000Z",
      }),
    ]);

    expect(
      screen.getAllByRole("button", { name: /edit late movie/i }),
    ).toHaveLength(2);
  });

  it("starts a new block at the clicked hour", () => {
    const { onCreate } = renderWeek([]);
    const wednesday = screen.getByRole("button", {
      name: "Add a block on Wed 4",
    });
    vi.spyOn(wednesday, "getBoundingClientRect").mockReturnValue({
      bottom: 1_344,
      height: 1_344,
      left: 0,
      right: 100,
      top: 0,
      width: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.click(wednesday, { clientY: 420 });

    expect(onCreate).toHaveBeenCalledWith("2026-03-04", 7);
  });
});
