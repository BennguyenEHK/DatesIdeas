import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { CopyLink } from "./CopyLink";

let written: string[] = [];

function stubClipboard(fail = false) {
  written = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (t: string) => {
        if (fail) return Promise.reject(new Error("denied"));
        written.push(t);
        return Promise.resolve();
      },
    },
  });
}

beforeEach(() => {
  stubClipboard();
  window.history.replaceState({}, "", "/room/ABCDEF");
});

afterEach(() => vi.useRealTimers());

describe("CopyLink", () => {
  it("copies a link that opens the room directly", async () => {
    render(<CopyLink code="ABCDEF" closesIn="23h" />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(written).toEqual(["http://localhost:3000/room/ABCDEF"]));
  });

  it("says what it did", async () => {
    render(<CopyLink code="ABCDEF" closesIn="23h" />);
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByText(/link copied/i)).toBeTruthy();
  });

  it("goes back to offering the link", async () => {
    // Fake timers from the start: the "copied" state is cleared by a timer
    // scheduled inside the click, so it has to be a fake one to be advanced.
    vi.useFakeTimers();
    render(<CopyLink code="ABCDEF" closesIn="23h" />);
    fireEvent.click(screen.getByRole("button"));
    // Let the clipboard promise settle; that is a microtask, not a timer.
    await act(async () => {});
    expect(screen.queryByText(/link copied/i)).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(2500);
    });
    expect(screen.queryByText(/link copied/i)).toBeNull();
    expect(screen.queryByText(/copy link/i)).toBeTruthy();
  });

  it("shows the link to copy by hand when the clipboard refuses", async () => {
    // Clipboard access can be denied outright. "Copy" that silently does
    // nothing is worse than no button at all.
    stubClipboard(true);
    render(<CopyLink code="ABCDEF" closesIn="23h" />);
    fireEvent.click(screen.getByRole("button"));
    const field = await screen.findByLabelText(/copy this link/i);
    expect((field as HTMLInputElement).value).toBe(
      "http://localhost:3000/room/ABCDEF",
    );
  });

  it("copes with a browser that has no clipboard at all", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    render(<CopyLink code="ABCDEF" closesIn="23h" />);
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByLabelText(/copy this link/i)).toBeTruthy();
  });

  it("always shows the code, for reading down a phone line", () => {
    render(<CopyLink code="ABCDEF" closesIn="23h" />);
    expect(screen.getByText("ABCDEF")).toBeTruthy();
  });

  it("says how long the room has left", () => {
    render(<CopyLink code="ABCDEF" closesIn="23h" />);
    expect(screen.getByText(/closes in 23h/i)).toBeTruthy();
  });

  it("says nothing about closing when it does not know", () => {
    // Better silent than wrong about when the evening ends.
    render(<CopyLink code="ABCDEF" closesIn={null} />);
    expect(screen.queryByText(/closes in/i)).toBeNull();
  });

  it("names the action, not the mechanism", () => {
    render(<CopyLink code="ABCDEF" closesIn="23h" />);
    const name = screen.getByRole("button").getAttribute("aria-label") ?? "";
    expect(name.toLowerCase()).toContain("link");
  });
});
