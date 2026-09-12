import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
