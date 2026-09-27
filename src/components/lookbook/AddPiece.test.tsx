import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AddPiece } from "./AddPiece";
import type { LookbookView } from "@/lib/lookbook/contract";
const cameraMocks = vi.hoisted(() => {
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
  return { stop, stream };
});
vi.mock("@/lib/album/capture", () => ({
  openCamera: vi.fn().mockResolvedValue(cameraMocks.stream),
  stopCamera: (value: MediaStream | null) => value?.getTracks().forEach((track) => track.stop()),
  takePhoto: vi.fn(),
}));
const makeView = () =>
  ({ adding: false, addPiece: vi.fn().mockResolvedValue(true) }) as unknown as LookbookView;
describe("AddPiece", () => {
  it("keeps Add disabled until a kind is picked and stops camera on close", () => {
    const onClose = vi.fn();
    render(<AddPiece view={makeView()} onClose={onClose} />);
    expect(screen.getByRole("button", { name: "Add" }).hasAttribute("disabled")).toBe(true);
    screen.getByRole("button", { name: "Top" }).click();
    expect(screen.getByRole("button", { name: "Add" }).hasAttribute("disabled")).toBe(true);
    screen.getByRole("button", { name: "Close" }).click();
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the live camera, and switches it off when the dialog closes", async () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockImplementation(() => Promise.resolve());
    const onClose = vi.fn();
    render(<AddPiece view={makeView()} onClose={onClose} />);
    await act(async () => screen.getByRole("button", { name: "Take a photo" }).click());
    const video = await waitFor(() => {
      const element = document.querySelector("video");
      expect(element).not.toBeNull();
      return element as HTMLVideoElement;
    });
    await waitFor(() => expect(video.srcObject).toBe(cameraMocks.stream));
    expect(play).toHaveBeenCalled();
    cameraMocks.stop.mockClear();
    act(() => screen.getByRole("button", { name: "Close" }).click());
    expect(cameraMocks.stop).toHaveBeenCalled();
    play.mockRestore();
  });
});
