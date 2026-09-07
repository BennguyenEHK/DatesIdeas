import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { VideoTile } from "./VideoTile";

/** A stream only needs to be non-null here; nothing reads its tracks. */
const stream = {} as MediaStream;

function tile(overrides: Partial<Parameters<typeof VideoTile>[0]> = {}) {
  return render(
    <VideoTile
      stream={stream}
      mirrored={false}
      muted={false}
      label="Them"
      memes={[]}
      placeholder="Waiting for them to arrive."
      {...overrides}
    />,
  );
}

describe("VideoTile", () => {
  it("says why the picture is black instead of leaving it unexplained", () => {
    // Switching a camera off does not stop the track, it disables it -- so the
    // other side goes on receiving black frames. Without a word over them that
    // is indistinguishable from a connection that has died.
    tile({ cameraOff: "Their camera is off." });
    expect(screen.getByText("Their camera is off.")).toBeTruthy();
  });

  it("KEEPS THE VIDEO MOUNTED, because it is what plays their voice", () => {
    // The remote tile is the element carrying the audio. Replacing it with a
    // message would switch their camera off and take their sound with it.
    const view = tile({ cameraOff: "Their camera is off." });
    expect(view.container.querySelector("video")).not.toBeNull();
  });

  it("shows the ordinary picture when the camera is on", () => {
    const view = tile({ cameraOff: null });
    expect(view.container.querySelector("video")).not.toBeNull();
    expect(screen.queryByText(/camera is off/i)).toBeNull();
  });

  it("marks a muted microphone in words, not only as a glyph", () => {
    // Silence is otherwise indistinguishable from somebody not talking, which
    // is most of any evening -- and a glyph alone says nothing out loud.
    tile({ micOff: true });
    expect(screen.getByText("Them muted")).toBeTruthy();
  });

  it("says nothing about a microphone that is on", () => {
    tile({ micOff: false });
    expect(screen.queryByText(/muted/i)).toBeNull();
  });

  it("still explains an absent stream, which is a different problem", () => {
    // No stream at all is somebody who has not arrived or whose camera was
    // refused. That is not the same as a camera deliberately switched off, and
    // the tile must not start calling one the other.
    tile({ stream: null, cameraOff: "Their camera is off." });
    expect(screen.getByText("Waiting for them to arrive.")).toBeTruthy();
    expect(screen.queryByText("Their camera is off.")).toBeNull();
  });
});
