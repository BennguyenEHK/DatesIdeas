import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TimeBlock } from "@/lib/calendar/blocks";
import { BlockEditor } from "./BlockEditor";

function existingBlock(overrides: Partial<TimeBlock> = {}): TimeBlock {
  return {
    id: "one",
    title: "Call",
    note: null,
    startsAt: "2026-03-04T09:00:00.000Z",
    endsAt: "2026-03-04T10:00:00.000Z",
    zone: "UTC",
    owner: "both",
    repeat: "none",
    repeatUntil: null,
    remindMinutes: null,
    ...overrides,
  };
}

function renderNew(onSave = vi.fn().mockResolvedValue(null)) {
  render(
    <BlockEditor
      block={null}
      initial={{ date: "2026-03-04", hour: 9 }}
      viewerZone="UTC"
      onSave={onSave}
      onDelete={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  return onSave;
}

describe("BlockEditor", () => {
  it("sends an ISO block and shows the server's error", async () => {
    const onSave = vi.fn().mockResolvedValue("this needs a name");
    renderNew(onSave);

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Breakfast" },
    });
    fireEvent.submit(
      screen.getByRole("button", { name: "Save this time" }).closest("form")!,
    );

    await screen.findByRole("alert");
    expect(onSave.mock.calls[0][0]).toMatchObject({
      title: "Breakfast",
      zone: expect.any(String),
    });
    expect(screen.getByRole("alert").textContent).toContain("this needs a name");
  });

  it("makes deletion a deliberate second step", () => {
    const onDelete = vi.fn().mockResolvedValue(null);
    render(
      <BlockEditor
        block={existingBlock()}
        initial={null}
        viewerZone="UTC"
        onSave={vi.fn()}
        onDelete={onDelete}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText(/removes it from both/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete this time" }));
    expect(onDelete).toHaveBeenCalledWith("one");
  });

  it("edits an existing start in the viewer's wall-clock time", () => {
    render(
      <BlockEditor
        block={existingBlock({
          startsAt: "2026-07-14T13:00:00.000Z",
          endsAt: "2026-07-14T14:00:00.000Z",
        })}
        initial={null}
        viewerZone="Asia/Ho_Chi_Minh"
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Start date").getAttribute("value")).toBe(
      "2026-07-14",
    );
    expect(screen.getByLabelText("Start time").getAttribute("value")).toBe(
      "20:00",
    );
  });

  it("refuses an end before its start without saving", async () => {
    const onSave = renderNew();
    fireEvent.change(screen.getByLabelText("End time"), {
      target: { value: "08:00" },
    });
    fireEvent.submit(
      screen.getByRole("button", { name: "Save this time" }).closest("form")!,
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "End must be after the start.",
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it("sends the selected repeat and inclusive repeat end", async () => {
    const onSave = renderNew();
    fireEvent.change(screen.getByLabelText("Repeat"), {
      target: { value: "weekly" },
    });
    fireEvent.change(screen.getByLabelText("Repeat until"), {
      target: { value: "2026-04-01" },
    });
    fireEvent.submit(
      screen.getByRole("button", { name: "Save this time" }).closest("form")!,
    );

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({
      repeat: "weekly",
      repeatUntil: "2026-04-01",
    });
  });
});
