import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RoomControls } from "./RoomControls";

function setup(overrides: Partial<Parameters<typeof RoomControls>[0]> = {}) {
  const props = {
    micOn: true,
    camOn: true,
    onMic: vi.fn(),
    onCam: vi.fn(),
    endsInMs: null as number | null,
    onEnd: vi.fn(),
    onStay: vi.fn(),
    ...overrides,
  };
  render(<RoomControls {...props} />);
  return props;
}

describe("RoomControls", () => {
  it("names the action, not the state, so the button says what pressing it does", () => {
    setup({ micOn: true, camOn: true });
    expect(screen.getByRole("button", { name: /turn microphone off/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /turn camera off/i })).toBeTruthy();
  });

  it("offers the way back once something is switched off", () => {
    setup({ micOn: false, camOn: false });
    expect(screen.getByRole("button", { name: /turn microphone on/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /turn camera on/i })).toBeTruthy();
  });

  it("reports the switch it is asking for rather than the one it is in", () => {
    const props = setup({ micOn: true });
    fireEvent.click(screen.getByRole("button", { name: /turn microphone off/i }));
    expect(props.onMic).toHaveBeenCalledWith(false);
  });

  it("turns a camera back on from off", () => {
    const props = setup({ camOn: false });
    fireEvent.click(screen.getByRole("button", { name: /turn camera on/i }));
    expect(props.onCam).toHaveBeenCalledWith(true);
  });

  it("says which switches are off to a screen reader, not just in colour", () => {
    // The off state is carried by an accent and a struck-through glyph, and
    // neither of those reaches somebody who is not looking at it. The name
    // does: "turn it on" can only mean it is currently off.
    setup({ micOn: false, camOn: true });
    expect(screen.getByRole("button", { name: /turn microphone on/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /turn camera off/i })).toBeTruthy();
  });

  it("does not also claim a pressed state, which would say the opposite", () => {
    // A name describing the ACTION and an aria-pressed describing the STATE are
    // deliberately inverse, so a button carrying both announces itself as
    // "turn microphone on, not pressed" -- two facts that sound like a
    // contradiction. The name alone is unambiguous, so the name alone is used.
    setup({ micOn: false });
    expect(
      screen.getByRole("button", { name: /turn microphone on/i }).hasAttribute("aria-pressed"),
    ).toBe(false);
  });

  it("offers to end the evening while one is still running", () => {
    setup({ endsInMs: null });
    expect(screen.getByRole("button", { name: /end the evening/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^stay$/i })).toBeNull();
  });

  it("counts down in the open, where the way out of it also lives", () => {
    // Pressing the ending is one press away from the end of somebody's night,
    // so the undo cannot be hidden behind a second screen.
    setup({ endsInMs: 298_000 });
    expect(screen.getByText(/4:58/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /stay/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /end the evening/i })).toBeNull();
  });

  it("calls it off when asked to stay", () => {
    const props = setup({ endsInMs: 120_000 });
    fireEvent.click(screen.getByRole("button", { name: /stay/i }));
    expect(props.onStay).toHaveBeenCalled();
  });

  it("announces the countdown politely rather than interrupting", () => {
    // A countdown that re-announced itself every second over the top of the
    // evening would be unusable; polite lets it wait for a natural gap.
    setup({ endsInMs: 60_000 });
    const live = screen.getByRole("status");
    expect(live.getAttribute("aria-live")).toBe("polite");
  });

  it("keeps the hardware switches usable during the countdown", () => {
    // Five minutes is long enough to want the camera off for some of it.
    setup({ endsInMs: 60_000 });
    expect(
      screen.getByRole("button", { name: /turn camera off/i }).hasAttribute("disabled"),
    ).toBe(false);
  });
});
