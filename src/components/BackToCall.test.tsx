import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BackToCall } from "./BackToCall";

function setOpener(value: unknown) {
  Object.defineProperty(window, "opener", { value, configurable: true, writable: true });
}

afterEach(() => {
  cleanup();
  setOpener(null);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("BackToCall", () => {
  it("opens the room when there is no call tab to return to", () => {
    setOpener(null);
    render(<BackToCall room="AB CD" />);
    const link = screen.getByRole("link", { name: "Back to the call" });
    expect(link.getAttribute("href")).toBe("/room/AB%20CD");

    // Nothing intercepts the click, so the link is followed.
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("returns to the room's tab instead of joining the call a second time", () => {
    const opener = { closed: false, focus: vi.fn() };
    setOpener(opener);
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    render(<BackToCall room="ABCDEF" />);

    const link = screen.getByRole("link", { name: "Back to the call" });
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(opener.focus).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it("follows the link when the room's tab has already been closed", () => {
    setOpener({ closed: true, focus: vi.fn() });
    render(<BackToCall room="ABCDEF" />);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    screen.getByRole("link", { name: "Back to the call" }).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("says where the call is when the browser will not close this tab", () => {
    vi.useFakeTimers();
    setOpener({ closed: false, focus: vi.fn() });
    // The tab refuses to close, so window.closed stays false.
    vi.spyOn(window, "close").mockImplementation(() => {});
    render(<BackToCall room="ABCDEF" />);

    fireEvent.click(screen.getByRole("link", { name: "Back to the call" }));
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(screen.getByRole("status").textContent).toMatch(/still running in its own tab/);
  });
});
