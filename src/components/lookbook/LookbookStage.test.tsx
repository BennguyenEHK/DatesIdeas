import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LookbookStage } from "./LookbookStage";
import type { LookbookView } from "@/lib/lookbook/contract";

const view = (status: LookbookView["status"]) =>
  ({
    status,
    error: "Nope",
    open: null,
    pieces: [],
    outfits: [],
    me: "me",
    adding: false,
    reload: vi.fn(),
  }) as unknown as LookbookView;
describe("LookbookStage", () => {
  it("renders nothing when unpaired", () => {
    const { container } = render(<LookbookStage view={view("unpaired")} onKeepInAlbum={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
  it("shows loading and retryable errors", () => {
    render(<LookbookStage view={view("loading")} onKeepInAlbum={vi.fn()} />);
    expect(screen.getByText(/Opening the lookbook/)).toBeTruthy();
  });

  it("retries an error from the same view it was given", () => {
    const failed = view("error");
    render(<LookbookStage view={failed} onKeepInAlbum={vi.fn()} />);
    expect(screen.getByText("Nope")).toBeTruthy();
    screen.getByRole("button", { name: "Try again" }).click();
    expect(failed.reload).toHaveBeenCalledOnce();
  });

  it("shows the newly opened outfit's own name, not the last one's", () => {
    const outfit = (id: string, name: string) => ({
      id,
      name,
      wearOn: null,
      note: "",
      createdBy: "me",
      lovedBy: [],
      layout: [],
      createdAt: "",
      updatedAt: "",
    });
    const ready = (open: ReturnType<typeof outfit>) =>
      ({ ...view("ready"), open, openOutfit: vi.fn() }) as unknown as LookbookView;
    const { rerender } = render(
      <LookbookStage view={ready(outfit("outfit1", "Friday"))} onKeepInAlbum={vi.fn()} />,
    );
    expect((screen.getByRole("textbox", { name: "Outfit name" }) as HTMLInputElement).value).toBe(
      "Friday",
    );
    rerender(<LookbookStage view={ready(outfit("outfit2", "Brunch"))} onKeepInAlbum={vi.fn()} />);
    expect((screen.getByRole("textbox", { name: "Outfit name" }) as HTMLInputElement).value).toBe(
      "Brunch",
    );
  });
});
