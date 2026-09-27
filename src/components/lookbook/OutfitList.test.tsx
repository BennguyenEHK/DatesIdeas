import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OutfitList } from "./OutfitList";
import type { LookbookView } from "@/lib/lookbook/contract";
const outfit = {
  id: "outfit1",
  name: "Friday",
  wearOn: "2026-09-27",
  note: "",
  createdBy: "me",
  lovedBy: ["me"],
  layout: [],
  createdAt: "",
  updatedAt: "",
};
describe("OutfitList", () => {
  it("opens a card and creates from the empty state", () => {
    const openOutfit = vi.fn();
    const createOutfit = vi.fn();
    const view = {
      outfits: [outfit],
      pieces: [],
      openOutfit,
      createOutfit,
    } as unknown as LookbookView;
    render(<OutfitList view={view} />);
    screen.getByRole("button", { name: /Friday/ }).click();
    expect(openOutfit).toHaveBeenCalledWith("outfit1");
    screen.getByRole("button", { name: "New outfit" }).click();
    expect(createOutfit).toHaveBeenCalled();
  });
});
