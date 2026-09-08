import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LiveToggle } from "./LiveToggle";

function setup(overrides: Partial<Parameters<typeof LiveToggle>[0]> = {}) {
  const props = {
    live: false,
    enabled: true,
    onChange: vi.fn(),
    ...overrides,
  };
  render(<LiveToggle {...props} />);
  return props;
}

describe("LiveToggle", () => {
  it("presents the two modes as one radio group and announces the current mode", () => {
    setup({ live: true });

    expect(screen.getByRole("radiogroup", { name: /performance mode/i })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Karaoke" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("radio", { name: "Live" }).getAttribute("aria-checked")).toBe("true");
  });

  it("asks to enter live mode when its position is pressed", () => {
    const props = setup({ live: false });
    fireEvent.click(screen.getByRole("radio", { name: "Live" }));
    expect(props.onChange).toHaveBeenCalledWith(true);
  });

  it("asks to return to karaoke when that mode is pressed", () => {
    const props = setup({ live: true });
    fireEvent.click(screen.getByRole("radio", { name: "Karaoke" }));
    expect(props.onChange).toHaveBeenCalledWith(false);
  });

  it("keeps the unavailable switch visible but inert, with the reason available on hover", () => {
    const props = setup({ enabled: false });
    const live = screen.getByRole("radio", { name: "Live" });

    expect(live).toHaveProperty("disabled", true);
    expect(live.getAttribute("title")).toBe("Live mode needs someone to perform to.");
    fireEvent.click(live);
    expect(props.onChange).not.toHaveBeenCalled();
  });
});
