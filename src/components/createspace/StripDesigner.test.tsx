import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderLookLayers } from "@/lib/createspace/compose";
import { MENU_SESSION, type CreateSession } from "@/lib/createspace/session";
import { looksClient } from "@/lib/looks/client";
import type { CreateSpaceProps } from "../CreateSpace";
import { StripDesigner } from "./StripDesigner";

vi.mock("@/lib/looks/client", () => ({
  looksClient: { sourceUrl: vi.fn(), uploadSource: vi.fn(), save: vi.fn() },
}));
vi.mock("@/lib/createspace/compose", () => ({ renderLookLayers: vi.fn() }));
vi.mock("@/lib/photo/backdrops", () => ({ loadBackdrop: vi.fn() }));
vi.mock("./StripCanvas", () => ({ StripCanvas: () => <div aria-label="Strip canvas" /> }));

function input(patch: Partial<CreateSession> = {}): CreateSpaceProps {
  return {
    identity: "me",
    room: "r",
    sharedNow: () => 20,
    scene: { items: [] },
    baseItemId: null,
    session: { ...MENU_SESSION, workshop: "strip", ...patch },
    onOp: vi.fn(),
    onBase: vi.fn(),
    onSession: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    editStripUrl: null,
    onFinishEdit: vi.fn(),
    localStream: null,
    remoteStream: null,
    paired: true,
    onLookSaved: vi.fn(),
  };
}

afterEach(() => vi.clearAllMocks());

describe("StripDesigner", () => {
  it("renders the selected number of shots and changes it", () => {
    const value = input({ shots: 3 });
    render(<StripDesigner {...value} />);
    expect(screen.getByRole("radio", { name: "3" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "4" }));
    expect(value.onSession).toHaveBeenCalledWith({ shots: 4 });
  });

  it("calls undo and redo and keeps unavailable actions disabled", () => {
    const value = input();
    render(<StripDesigner {...value} />);
    expect((screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Redo" }) as HTMLButtonElement).disabled).toBe(true);

    const ready = input();
    ready.canUndo = true;
    ready.canRedo = true;
    render(<StripDesigner {...ready} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Undo" })[1]);
    fireEvent.click(screen.getAllByRole("button", { name: "Redo" })[1]);
    expect(ready.undo).toHaveBeenCalledOnce();
    expect(ready.redo).toHaveBeenCalledOnce();
  });

  it("requires two presses to delete shared marks and toggles Merge", () => {
    const value = input();
    render(<StripDesigner {...value} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(value.onOp).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /delete for both/i }));
    expect(value.onOp).toHaveBeenCalledWith({ kind: "clear" });
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    expect(value.onSession).toHaveBeenCalledWith({ merge: true });
  });

  it("uploads a background and shares its placement key", async () => {
    vi.mocked(looksClient.uploadSource).mockResolvedValue({
      ok: true,
      source: { key: "background-key", url: "x" },
    });
    const value = input();
    render(<StripDesigner {...value} />);
    const file = new File(["x"], "sky.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Upload background"), { target: { files: [file] } });
    await vi.waitFor(() =>
      expect(value.onSession).toHaveBeenCalledWith({
        backdrop: { key: "background-key", x: 0.5, y: 0.5, scale: 1 },
      }),
    );
  });

  it("disables personal backgrounds before pairing", () => {
    const value = input();
    value.paired = false;
    render(<StripDesigner {...value} />);
    expect((screen.getByLabelText("Upload background") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/pair this device/i)).toBeTruthy();
  });

  it("saves an edit back to the booth and hides strip setup", () => {
    const value = input({ mode: "edit" });
    value.editStripUrl = "strip.png";
    render(<StripDesigner {...value} />);
    expect(screen.queryByRole("radiogroup", { name: "Number of photos" })).toBeNull();
    expect(screen.queryByRole("toolbar", { name: "Background picture" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(value.onFinishEdit).toHaveBeenCalledOnce();
  });

  it("renders and saves a new look", async () => {
    const value = input();
    const backdrop = new Blob(["base"]);
    const overlay = new Blob(["top"]);
    vi.mocked(renderLookLayers).mockResolvedValue({ backdrop, overlay });
    vi.mocked(looksClient.save).mockResolvedValue({
      ok: true,
      look: {
        id: "look-123",
        name: "Our look 1",
        shots: 1,
        ink: "#f5efe0",
        backdropUrl: "a",
        overlayUrl: "b",
        createdAt: "now",
      },
    });
    render(<StripDesigner {...value} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Save look" }));
    await vi.waitFor(() => expect(renderLookLayers).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(looksClient.save).toHaveBeenCalledOnce());
    expect(value.onLookSaved).toHaveBeenCalledOnce();
  });
});
