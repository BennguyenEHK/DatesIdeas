import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ChatBubble } from "./ChatBubble";
import type { ChatLine } from "@/lib/ui/chatLog";

afterEach(cleanup);

const line = (over: Partial<ChatLine> = {}): ChatLine => ({
  id: "a",
  text: "hello",
  at: 1,
  mine: false,
  ...over,
});

const bubble = () => screen.getByRole("button", { name: /chat/i });

describe("ChatBubble", () => {
  it("starts closed, so the film is not covered by a panel nobody opened", () => {
    render(<ChatBubble lines={[]} onSend={vi.fn()} ready />);
    expect(bubble()).toHaveProperty("ariaExpanded", "false");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("opens the conversation when the bulb is pressed", async () => {
    const { rerender } = render(<ChatBubble lines={[]} onSend={vi.fn()} ready />);
    bubble().click();
    rerender(<ChatBubble lines={[]} onSend={vi.fn()} ready />);
    expect(screen.queryByRole("textbox")).not.toBeNull();
  });

  /**
   * The point of the whole design: being told something was said must not mean
   * having the film covered by a panel you did not ask for.
   */
  it("announces an arriving line without opening the panel", () => {
    const { rerender } = render(<ChatBubble lines={[]} onSend={vi.fn()} ready />);
    rerender(<ChatBubble lines={[line({ text: "are you seeing this" })]} onSend={vi.fn()} ready />);

    expect(screen.getByRole("status")).toHaveProperty(
      "textContent",
      "are you seeing this",
    );
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("counts what is waiting, and says so to a screen reader", () => {
    const { rerender } = render(<ChatBubble lines={[]} onSend={vi.fn()} ready />);
    rerender(
      <ChatBubble
        lines={[line({ id: "1" }), line({ id: "2" })]}
        onSend={vi.fn()}
        ready
      />,
    );
    expect(screen.getByRole("button", { name: /2 new messages/i })).toBeTruthy();
  });

  it("uses the singular for a single message", () => {
    const { rerender } = render(<ChatBubble lines={[]} onSend={vi.fn()} ready />);
    rerender(<ChatBubble lines={[line({ id: "1" })]} onSend={vi.fn()} ready />);
    expect(screen.getByRole("button", { name: /1 new message$/i })).toBeTruthy();
  });

  it("says nothing about your own words", () => {
    // You already know what you just typed, and the panel you sent it from is
    // showing it. Announcing it back would be noise.
    const { rerender } = render(<ChatBubble lines={[]} onSend={vi.fn()} ready />);
    rerender(<ChatBubble lines={[line({ mine: true })]} onSend={vi.fn()} ready />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("clears what was waiting once the conversation is open", () => {
    const { rerender } = render(<ChatBubble lines={[]} onSend={vi.fn()} ready />);
    rerender(<ChatBubble lines={[line()]} onSend={vi.fn()} ready />);
    bubble().click();
    rerender(<ChatBubble lines={[line()]} onSend={vi.fn()} ready />);

    // Deliberately not asserting the toast has left the DOM: it is inside an
    // AnimatePresence and lingers while it animates out, so a query here
    // catches it mid-exit and proves nothing either way. What matters is that
    // the count is gone and the conversation is showing.
    expect(screen.getByRole("button", { name: /close chat/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /new message/i })).toBeNull();
    expect(screen.queryByRole("textbox")).not.toBeNull();
  });

  it("does not re-announce a line when the log drops its oldest", () => {
    // The log is capped, so it can shrink. A high-water mark left behind by a
    // longer list would swallow the next genuine arrival.
    const { rerender } = render(
      <ChatBubble lines={[line({ id: "1" }), line({ id: "2" })]} onSend={vi.fn()} ready />,
    );
    rerender(<ChatBubble lines={[line({ id: "2" })]} onSend={vi.fn()} ready />);
    rerender(
      <ChatBubble lines={[line({ id: "2" }), line({ id: "3" })]} onSend={vi.fn()} ready />,
    );
    expect(screen.getByRole("button", { name: /1 new message$/i })).toBeTruthy();
  });
});
