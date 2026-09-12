import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecordButton } from "./RecordButton";

const mocks = vi.hoisted(() => ({
  listRecordings: vi.fn(),
  startCallRecording: vi.fn(),
}));

vi.mock("@/lib/recording/mixer", () => ({
  startCallRecording: mocks.startCallRecording,
}));

vi.mock("@/lib/recording/store", () => ({
  listRecordings: mocks.listRecordings,
}));

const sources = {
  localVideo: null,
  remoteVideo: null,
  localStream: null,
  remoteStream: null,
};

function renderRecordButton(
  onRecordingChange = vi.fn(),
  onFinished = vi.fn(),
) {
  render(
    <RecordButton
      room="room name"
      sources={sources}
      onRecordingChange={onRecordingChange}
      onFinished={onFinished}
    />,
  );

  return { onFinished, onRecordingChange };
}

describe("RecordButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listRecordings.mockReturnValue(new Promise(() => {}));
  });

  it("reports that recording started", () => {
    mocks.startCallRecording.mockReturnValue({
      cancel: vi.fn(),
      stop: vi.fn().mockResolvedValue(null),
    });
    const { onRecordingChange } = renderRecordButton();

    fireEvent.click(screen.getByLabelText("Start recording"));

    expect(onRecordingChange).toHaveBeenCalledWith(true);
  });

  it("reports that recording stopped and passes the finished clip on", async () => {
    const result = {
      blob: new Blob(["clip"], { type: "video/webm" }),
      mimeType: "video/webm",
      durationMs: 1200,
    };
    mocks.startCallRecording.mockReturnValue({
      cancel: vi.fn(),
      stop: vi.fn().mockResolvedValue(result),
    });
    const { onFinished, onRecordingChange } = renderRecordButton();

    fireEvent.click(screen.getByLabelText("Start recording"));
    fireEvent.click(screen.getByLabelText("Stop recording"));

    await waitFor(() => {
      expect(onFinished).toHaveBeenCalledWith(result);
    });
    expect(onRecordingChange).toHaveBeenNthCalledWith(2, false);
  });

  it("explains when the browser cannot record without reporting a state change", () => {
    mocks.startCallRecording.mockReturnValue(null);
    const { onRecordingChange } = renderRecordButton();

    fireEvent.click(screen.getByLabelText("Start recording"));

    expect(
      screen
        .getByLabelText("Recording is unavailable in this browser")
        .getAttribute("aria-pressed"),
    ).toBe("false");
    expect(screen.getByText("Can’t record here")).toBeTruthy();
    expect(onRecordingChange).not.toHaveBeenCalled();
  });

  it("links to the recordings for the room", () => {
    renderRecordButton();

    expect(
      screen.getByLabelText("View recordings").getAttribute("href"),
    ).toBe("/recordings/room%20name");
    // Its own tab. Navigating this one away from the room would end the call.
    expect(screen.getByLabelText("View recordings").getAttribute("target")).toBe(
      "festibooth-cutting-room",
    );
  });
});
