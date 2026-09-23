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

  it("says it is getting this device in while the other screen lets it in", async () => {
    stubUnauthorized();
    render(<RoomCalendar {...PROPS} joining />);
    expect((await screen.findByRole("status")).textContent).toBe("Getting you in…");
  });

  it("says why joining failed and asks the other screen again on Try again", async () => {
    stubUnauthorized();
    const onRetryJoin = vi.fn();
    render(
      <RoomCalendar {...PROPS} joinError="Could not join the album" onRetryJoin={onRetryJoin} />,
    );
    expect(await screen.findByText("Could not join the album")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetryJoin).toHaveBeenCalledOnce();
  });

  it("offers to set up an album when nobody in the room is on one", async () => {
    stubUnauthorized();
    const onClose = vi.fn();
    render(<RoomCalendar {...PROPS} onClose={onClose} canBeInvited={false} />);
    expect(await screen.findByText("This device isn't on your calendar yet.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Set up your album" }).getAttribute("href")).toBe(
      "/us/new",
    );
    fireEvent.click(screen.getByRole("button", { name: "Back to the call" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("asks for the calendar again once revision rises after joining", async () => {
    const fetchMock = stubUnauthorized();
    const { rerender } = render(<RoomCalendar {...PROPS} joining />);
    await screen.findByText("Getting you in…");
    const callsBefore = fetchMock.mock.calls.length;
    rerender(<RoomCalendar {...PROPS} revision={1} />);
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore));
    expect(screen.queryByText("Getting you in…")).toBeNull();
  });
});

const PROPS = {
  week: null,
  revision: 0,
  onWeek: () => undefined,
  onChanged: () => undefined,
  onClose: () => undefined,
};

function stubUnauthorized() {
  const fetchMock = vi.fn(() =>
    Promise.resolve({ ok: false, status: 401, json: async () => ({}) } as Response),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
