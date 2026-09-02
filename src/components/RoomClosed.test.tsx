import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RoomClosed } from "./RoomClosed";

const noop = { onStart: () => {}, pending: false };

describe("RoomClosed", () => {
  it("says the evening is over when the room expired", () => {
    render(<RoomClosed status="expired" code="ABCDEF" {...noop} />);
    expect(screen.getByRole("heading").textContent).toMatch(/ended/i);
  });

  it("says the code is wrong when there was never such a room", () => {
    // A mistyped code and a finished evening need different next moves, so
    // they are never given the same message.
    render(<RoomClosed status="missing" code="ABCDEF" {...noop} />);
    expect(screen.getByRole("heading").textContent).not.toMatch(/ended/i);
    expect(document.body.textContent).toMatch(/no room/i);
  });

  it("explains the rule rather than just the outcome", () => {
    render(<RoomClosed status="expired" code="ABCDEF" {...noop} />);
    expect(document.body.textContent).toMatch(/day/i);
  });

  it("offers the way out", () => {
    const onStart = vi.fn();
    render(<RoomClosed status="expired" code="ABCDEF" onStart={onStart} pending={false} />);
    fireEvent.click(screen.getByRole("button", { name: /start a new evening/i }));
    expect(onStart).toHaveBeenCalled();
  });

  it("cannot be pressed twice while a room is being opened", () => {
    render(<RoomClosed status="expired" code="ABCDEF" onStart={() => {}} pending />);
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the code that failed, so a typo is visible", () => {
    render(<RoomClosed status="missing" code="ABCDEF" {...noop} />);
    expect(screen.getByText("ABCDEF")).toBeTruthy();
  });

  it("passes on a problem opening the new room", () => {
    render(
      <RoomClosed status="expired" code="ABCDEF" {...noop} error="Could not open a room just now." />,
    );
    expect(screen.getByRole("alert").textContent).toMatch(/could not open/i);
  });
});
