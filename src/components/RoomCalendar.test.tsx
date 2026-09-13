import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoomCalendar } from "./RoomCalendar";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("RoomCalendar", () => {
  it("explains a missing season ticket and keeps a route back to the call", async () => {
    const onClose = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false, status: 401, json: async () => ({}) } as Response)),
    );

    render(
      <RoomCalendar
        week={null}
        revision={0}
        onWeek={vi.fn()}
        onChanged={vi.fn()}
        onClose={onClose}
      />,
    );

    expect(await screen.findByText("This device isn't on your calendar yet.")).toBeTruthy();
    expect(
      screen.getByText("Open the album on the other device and scan the season ticket QR."),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Back to the call" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
