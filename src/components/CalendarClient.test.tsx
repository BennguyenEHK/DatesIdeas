import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TimeBlock } from "@/lib/calendar/blocks";
import { CalendarClient } from "./CalendarClient";

function response(ok: boolean, body: unknown): Response {
  return {
    ok,
    json: async () => body,
  } as Response;
}

function block(overrides: Partial<TimeBlock> = {}): TimeBlock {
  return {
    id: "dinner",
    title: "Dinner",
    note: null,
    startsAt: "2026-07-14T13:00:00.000Z",
    endsAt: "2026-07-14T14:00:00.000Z",
    zone: "Asia/Ho_Chi_Minh",
    owner: "both",
    repeat: "none",
    repeatUntil: null,
    remindMinutes: null,
    ...overrides,
  };
}

async function openCalendar(fetchMock: ReturnType<typeof vi.fn>) {
  render(<CalendarClient />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("CalendarClient", () => {
  it("loads calendar blocks and shows their titles in the week", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T12:00:00.000Z"));
    const fetchMock = vi.fn((_input: RequestInfo | URL) =>
      Promise.resolve(response(true, { blocks: [block({ title: "Garden dinner" })] })),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<CalendarClient />);
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(
      screen.getByRole("button", { name: /edit garden dinner/i }),
    ).toBeTruthy();
    expect(fetchMock.mock.calls[0][0]).toMatch(/^\/api\/calendar\?until=/);
  });

  it("moves forward a week and returns to the original days", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(response(true, { blocks: [] })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await openCalendar(fetchMock);
    const originalMonday = screen
      .getByRole("button", {
        name: /add a block on mon/i,
      })
      .getAttribute("aria-label") ?? "";

    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: originalMonday }),
      ).toBeNull(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
    expect(
      await screen.findByRole("button", { name: originalMonday }),
    ).toBeTruthy();
  });

  it("shows the companion's local time alongside the viewer's", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T12:00:00.000Z"));
    const fetchMock = vi.fn(() =>
      Promise.resolve(response(true, { blocks: [block()] })),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<CalendarClient viewerZone="Asia/Ho_Chi_Minh" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    fireEvent.change(screen.getByLabelText("Second timezone"), {
      target: { value: "Europe/London" },
    });

    expect(screen.getByText(/20:00.*14:00 there/)).toBeTruthy();
  });

  it("reverts a failed optimistic create and uses the server's error", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => "temporary" });
    let rejectCreate: ((value: Response) => void) | null = null;
    const create = new Promise<Response>((resolve) => {
      rejectCreate = resolve;
    });
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        init?.method === "POST"
          ? create
          : Promise.resolve(response(true, { blocks: [] })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await openCalendar(fetchMock);
    fireEvent.click(screen.getByRole("button", { name: "Add time" }));
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Moonlit tea" },
    });
    fireEvent.submit(
      screen.getByRole("button", { name: "Save this time" }).closest("form")!,
    );

    expect(
      await screen.findByRole("button", { name: /edit moonlit tea/i }),
    ).toBeTruthy();
    await act(async () => {
      rejectCreate?.(response(false, { error: "The kitchen is closed." }));
    });

    expect((await screen.findByRole("alert")).textContent).toContain(
      "The kitchen is closed.",
    );
    expect(
      screen.queryByRole("button", { name: /edit moonlit tea/i }),
    ).toBeNull();
  });
});
