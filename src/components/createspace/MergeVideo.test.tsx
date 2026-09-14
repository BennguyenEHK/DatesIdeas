import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadLiveSegmenter } from "@/lib/createspace/liveSegment";
import { MergeVideo } from "./MergeVideo";

vi.mock("@/lib/createspace/liveSegment", () => ({ loadLiveSegmenter: vi.fn() }));

const panels = [{ x: 0, y: 0, width: 1, height: 1 }];

beforeEach(() => {
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.mocked(loadLiveSegmenter).mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("MergeVideo", () => {
  it("never loads segmentation for plain cameras without a backdrop", () => {
    render(<MergeVideo localStream={null} remoteStream={null} hasBackdrop={false} panels={panels} />);
    expect(loadLiveSegmenter).not.toHaveBeenCalled();
  });

  it("loads segmentation when cameras have a backdrop to merge into", async () => {
    render(<MergeVideo localStream={null} remoteStream={null} hasBackdrop panels={panels} />);
    await vi.waitFor(() => expect(loadLiveSegmenter).toHaveBeenCalledOnce());
  });
});
