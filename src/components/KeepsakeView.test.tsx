import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { KeepsakeView } from "./KeepsakeView";
import { FILL_MS } from "./HoldHeart";

// jsdom implements pointer events but not pointer capture, and the heart takes
// capture so a finger sliding off the button still counts as a hold.
HTMLElement.prototype.setPointerCapture ??= () => {};
HTMLElement.prototype.releasePointerCapture ??= () => {};

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126.0 Mobile Safari/537.36";

/**
 * Holds the heart to the top without waiting a real second and a bit.
 *
 * The component drives its fill from requestAnimationFrame timestamps rather
 * than from a frame count, so a fake clock is not enough on its own — the
 * timestamps have to move too.
 */
async function holdUntilFull(button: HTMLElement) {
  let clock = 0;
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});

  button.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }),
  );

  // Enough frames to cross FILL_MS at the 64ms-per-frame ceiling the loop caps at.
  for (let i = 0; i < Math.ceil(FILL_MS / 60) + 4; i += 1) {
    const next = frames.shift();
    if (next === undefined) break;
    clock += 60;
    next(clock);
  }
}

/** What the page hands to navigator.share, which the tests assert on. */
interface SharePayload {
  files: File[];
  title?: string;
}

function setup(options: {
  userAgent: string;
  canShare?: boolean;
  kind?: "strip" | "clip";
  contentType?: string;
}) {
  const share = vi.fn<(data: SharePayload) => Promise<void>>(async () => undefined);
  vi.stubGlobal("navigator", {
    userAgent: options.userAgent,
    maxTouchPoints: 5,
    share,
    canShare: () => options.canShare ?? true,
  });

  const bytes = new Blob(["png-bytes"], { type: options.contentType ?? "image/png" });
  // The narrowest response the page reads, rather than a real one: `Response`
  // is not reliably a global under jsdom, and a missing constructor would be
  // swallowed by the fetch's own catch and look like a storage failure.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, blob: async () => bytes })),
  );

  const view = render(
    <KeepsakeView
      url="https://storage.example/keepsakes/AB12CD/strip-abc.png?X-Amz-Signature=x"
      kind={options.kind ?? "strip"}
      contentType={options.contentType ?? "image/png"}
      room="AB12CD"
    />,
  );
  return { share, view };
}

let anchors: { download: string; clicked: boolean }[] = [];
let createElement: typeof document.createElement;

beforeEach(() => {
  anchors = [];
  createElement = document.createElement.bind(document);
  // The download route builds an anchor and clicks it; jsdom would navigate.
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    const node = createElement(tag);
    if (tag === "a") {
      const record = { download: "", clicked: false };
      anchors.push(record);
      Object.defineProperty(node, "download", {
        get: () => record.download,
        set: (value: string) => {
          record.download = value;
        },
      });
      node.click = () => {
        record.clicked = true;
      };
    }
    return node;
  }) as typeof document.createElement);
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: () => "blob:keepsake",
    revokeObjectURL: () => {},
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("which way a keepsake is saved", () => {
  it("downloads on Android rather than opening a chooser", async () => {
    const { share } = setup({ userAgent: ANDROID });

    await holdUntilFull(screen.getByRole("button"));

    await waitFor(() => expect(anchors.some((a) => a.clicked)).toBe(true));
    // The whole complaint: Android was being handed a share sheet for a file
    // its own gallery would have picked up from the downloads folder.
    expect(share).not.toHaveBeenCalled();
  });

  it("names the downloaded file itself instead of leaving it to the browser", async () => {
    setup({ userAgent: ANDROID });

    await holdUntilFull(screen.getByRole("button"));

    await waitFor(() => expect(anchors.some((a) => a.clicked)).toBe(true));
    expect(anchors.find((a) => a.clicked)?.download).toBe("festibooth-AB12CD.png");
  });

  it("opens the share sheet on an iPhone, where it is the only road to Photos", async () => {
    const { share } = setup({ userAgent: IPHONE });

    await holdUntilFull(screen.getByRole("button"));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const payload = share.mock.calls[0][0];
    expect(payload.files[0].name).toBe("festibooth-AB12CD.png");
    expect(payload.files[0].type).toBe("image/png");
    // A file-only payload, because a title alongside it pushes Save Image down.
    expect(payload.title).toBeUndefined();
  });

  it("downloads on an iPhone that cannot share this particular file", async () => {
    const { share } = setup({
      userAgent: IPHONE,
      canShare: false,
      kind: "clip",
      contentType: "video/webm",
    });

    await holdUntilFull(screen.getByRole("button"));

    await waitFor(() => expect(anchors.some((a) => a.clicked)).toBe(true));
    expect(share).not.toHaveBeenCalled();
  });
});

describe("what the page promises", () => {
  it("does not promise a chooser on the download route", () => {
    setup({ userAgent: ANDROID });
    expect(screen.getByText(/downloads straight to this device/i)).toBeTruthy();
  });

  it("names the right sheet action for a video", () => {
    setup({ userAgent: IPHONE, kind: "clip", contentType: "video/mp4" });
    expect(screen.getByText(/Choose Save Video/i)).toBeTruthy();
  });

  it("names the right sheet action for a photo strip", () => {
    setup({ userAgent: IPHONE });
    expect(screen.getByText(/Choose Save Image/i)).toBeTruthy();
  });
});
