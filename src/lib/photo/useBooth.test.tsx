import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createRef } from "react";
import { useBooth } from "./useBooth";
import { LEAD_MS, BETWEEN_MS } from "./booth";
import type { PeerMessage } from "@/lib/rtc/protocol";

// The heavy parts are covered by their own tests; what matters here is the
// sequencing and what does or does not go out over the connection.
vi.mock("./capture", () => ({
  captureFrame: vi.fn(() => ({ canvas: {}, width: 640, height: 360 })),
  frameToBlob: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("./segment", () => ({
  cutOutOrOriginal: vi.fn((f: unknown) => Promise.resolve(f)),
}));
vi.mock("./paint", () => ({ paintStrip: vi.fn() }));

const video = () => createRef<HTMLVideoElement>();

function setup() {
  const sent: PeerMessage[] = [];
  const view = renderHook(() =>
    useBooth({
      clock: null,
      send: (m) => sent.push(m),
      localVideo: video(),
      remoteVideo: video(),
      caption: "2 SEP 2026 · ABCDEF",
    }),
  );
  return { sent, ...view };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("starting a sitting", () => {
  it("tells the peer which look and how many, and when", async () => {
    const { sent, result } = setup();
    act(() => result.current.setThemeId("planetarium"));
    act(() => result.current.setShots(2));
    act(() => result.current.start());

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      t: "photo",
      themeId: "planetarium",
      shots: 2,
    });
  });

  it("sends an instant slightly ahead, not the instant it is now", () => {
    // The message has to arrive before the moment it describes, or the other
    // side joins a countdown already in progress.
    const before = Date.now();
    const { sent, result } = setup();
    act(() => result.current.start());
    const msg = sent[0];
    expect(msg.t === "photo" && msg.startAt).toBeGreaterThan(before);
  });

  it("counts down three, two, one before the first flash", async () => {
    const { result } = setup();
    act(() => result.current.start());

    await act(async () => void vi.advanceTimersByTime(400));
    expect(result.current.count).toBe(3);
    await act(async () => void vi.advanceTimersByTime(1000));
    expect(result.current.count).toBe(2);
    await act(async () => void vi.advanceTimersByTime(1000));
    expect(result.current.count).toBe(1);
  });

  it("flashes when the count runs out", async () => {
    const { result } = setup();
    act(() => result.current.start());
    await act(async () => void vi.advanceTimersByTime(400 + LEAD_MS));
    expect(result.current.flashing).toBe(true);
    expect(result.current.count).toBeNull();
  });

  it("takes a picture of both of you at each flash", async () => {
    const { captureFrame } = await import("./capture");
    const { result } = setup();
    act(() => result.current.setShots(2));
    act(() => result.current.start());

    await act(async () => void vi.advanceTimersByTime(400 + LEAD_MS));
    expect(captureFrame).toHaveBeenCalledTimes(2);
    await act(async () => void vi.advanceTimersByTime(BETWEEN_MS));
    expect(captureFrame).toHaveBeenCalledTimes(4);
  });

  it("mirrors your own camera and not theirs", async () => {
    // You posed against a mirror of yourself; they did not.
    const { captureFrame } = await import("./capture");
    const { result } = setup();
    act(() => result.current.start());
    await act(async () => void vi.advanceTimersByTime(400 + LEAD_MS));

    const calls = vi.mocked(captureFrame).mock.calls;
    expect(calls[0][1]).toMatchObject({ mirrored: true });
    expect(calls[1][1]).toBeUndefined();
  });

  it("will not start a second sitting over a running one", async () => {
    const { result } = setup();
    act(() => result.current.start());
    await act(async () => void vi.advanceTimersByTime(400));
    expect(result.current.running).toBe(true);
  });
});

describe("joining the peer's sitting", () => {
  const invite = (startAt: number): PeerMessage => ({
    t: "photo",
    themeId: "rose",
    shots: 2,
    startAt,
  });

  it("adopts their look and their length", () => {
    const { result } = setup();
    act(() => result.current.accept(invite(Date.now() + 100)));
    expect(result.current.themeId).toBe("rose");
    expect(result.current.shots).toBe(2);
  });

  it("does not answer back", () => {
    // Echoing an accepted sitting would have each side restarting the other's
    // countdown forever.
    const { sent, result } = setup();
    act(() => result.current.accept(invite(Date.now() + 100)));
    expect(sent).toEqual([]);
  });

  it("runs their countdown, not one of its own", async () => {
    const { result } = setup();
    act(() => result.current.accept(invite(Date.now() + 100)));
    await act(async () => void vi.advanceTimersByTime(100));
    expect(result.current.count).toBe(3);
    expect(result.current.running).toBe(true);
  });

  it("ignores anything that is not a sitting", () => {
    const { result } = setup();
    act(() =>
      result.current.accept({ t: "meme", id: "heart", showAt: 1 } satisfies PeerMessage),
    );
    expect(result.current.running).toBe(false);
  });
});

describe("the strip", () => {
  it("has nothing to show before any photographs are taken", () => {
    const { result } = setup();
    expect(result.current.stripUrl).toBeNull();
  });

  it("is not developed until the last flash has happened", async () => {
    const { paintStrip } = await import("./paint");
    const { result } = setup();
    act(() => result.current.setShots(2));
    act(() => result.current.start());
    await act(async () => void vi.advanceTimersByTime(400 + LEAD_MS));
    expect(paintStrip).not.toHaveBeenCalled();
  });
});
