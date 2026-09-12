import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MinecraftLauncher } from "./MinecraftLauncher";

describe("MinecraftLauncher", () => {
  it("offers joining tools without ever claiming a server status", () => {
    render(<MinecraftLauncher />);
    fireEvent.change(screen.getByLabelText("Server address"), { target: { value: "host:25566" } });
    expect(screen.getByRole("link", { name: "Open in Minecraft (Bedrock)" }).getAttribute("href")).toBe(
      "minecraft://?addExternalServer=GameWord%20server|host:25566",
    );
    expect(screen.queryByText(/status|online|offline/i)).toBeNull();
  });
});

describe("leaving the launcher", () => {
  it("offers a way back to the games when it was opened from them", () => {
    const onBack = vi.fn();
    render(<MinecraftLauncher onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: "Back to games" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
