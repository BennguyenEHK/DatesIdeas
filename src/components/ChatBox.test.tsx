import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ChatBox } from "./ChatBox";

function setup(overrides: Partial<Parameters<typeof ChatBox>[0]> = {}) {
  const props = { lines: [], onSend: vi.fn(), ready: true, ...overrides };
  render(<ChatBox {...props} />);
  return props;
}

describe("ChatBox", () => {
  it("sends a written whisper with Enter, not an empty thought", () => {
    const props = setup();
    const input = screen.getByRole("textbox", { name: /message/i });
    expect(screen.getByRole("button", { name: /^send$/i })).toHaveProperty("disabled", true);

    fireEvent.change(input, { target: { value: "  Look at that.  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onSend).toHaveBeenCalledWith("Look at that.");
  });

  it("does not turn Shift+Enter into an extra send", () => {
    const props = setup();
    const input = screen.getByRole("textbox", { name: /message/i });
    fireEvent.change(input, { target: { value: "Almost" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(props.onSend).not.toHaveBeenCalled();
  });

  it("sets the protocol's maximum on the actual input", () => {
    setup();
    expect(screen.getByRole("textbox", { name: /message/i }).getAttribute("maxlength")).toBe("500");
  });

  it("uses words as well as placement to distinguish you from them", () => {
    setup({
      lines: [
        { id: "theirs", text: "That skyline", at: 1, mine: false },
        { id: "mine", text: "I know", at: 2, mine: true },
      ],
    });
    expect(screen.getByText(/^them$/i)).toBeTruthy();
    expect(screen.getByText(/^you$/i)).toBeTruthy();
  });

  it("makes arrivals a polite live region", () => {
    setup();
    const log = screen.getByRole("log", { name: /messages/i });
    expect(log.getAttribute("aria-live")).toBe("polite");
  });

  it("states plainly when the route between the two seats is not open", () => {
    setup({ ready: false });
    expect(screen.getByRole("textbox", { name: /message/i })).toHaveProperty("disabled", true);
    expect(screen.getByText(/waiting for the chat connection/i)).toBeTruthy();
  });
});
