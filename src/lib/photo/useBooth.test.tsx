import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createRef } from "react";
import { useBooth } from "./useBooth";
import { LEAD_MS, BETWEEN_MS } from "./booth";
import type { PeerMessage } from "@/lib/rtc/protocol";
import type { SyncedClock } from "@/lib/sync/SyncedClock";

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

  it("counts all the way down from seven before the first flash", async () => {
    // Long enough that the pair of you can actually change pose between
    // photographs, which a shorter count did not leave room for.
    const { result } = setup();
    act(() => result.current.start());

    await act(async () => void vi.advanceTimersByTime(400));
    expect(result.current.count).toBe(7);
    await act(async () => void vi.advanceTimersByTime(1000));
    expect(result.current.count).toBe(6);
    await act(async () => void vi.advanceTimersByTime(4000));
    expect(result.current.count).toBe(2);
    await act(async () => void vi.advanceTimersByTime(1000));
    expect(result.current.count).toBe(1);
  });

  it("flashes when the count runs out, and starts the next count on the spot", async () => {
    // The gap between photographs IS the next countdown, so it begins at the
    // flash rather than after it -- that is what makes the interval the seven
    // seconds it claims to be.
    const { result } = setup();
    act(() => result.current.setShots(2));
    act(() => result.current.start());
    await act(async () => void vi.advanceTimersByTime(400 + LEAD_MS));
    expect(result.current.flashing).toBe(true);
    expect(result.current.count).toBe(7);
  });

  it("leaves no count hanging after the final flash", async () => {
    const { result } = setup();
    act(() => result.current.setShots(2));
    act(() => result.current.start());
    await act(async () => void vi.advanceTimersByTime(400 + LEAD_MS + BETWEEN_MS));
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
    expect(result.current.count).toBe(7);
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

describe("a sitting with the peer's clock in hand", () => {
  /**
   * Only `now` is reachable from the booth, which is the point of this test.
   *
   * The booth used to hand every step to SyncedClock.scheduleAt, and that
   * method fires anything more than two seconds out IMMEDIATELY -- a guard
   * that is right for an emoji reaction and catastrophic for a sitting that
   * lasts half a minute. Every flash past the first landed in the same tick,
   * so all four photographs were the same frame and the strip developed
   * before the countdown had finished. A stub with no scheduleAt at all is
   * what keeps that from creeping back: if the booth ever reaches for it
   * again, this suite stops compiling.
   */
  function setupWithClock() {
    const sent: PeerMessage[] = [];
    const clock = { now: () => Date.now() } as unknown as SyncedClock;
    const view = renderHook(() =>
      useBooth({
        clock,
        send: (m) => sent.push(m),
        localVideo: video(),
        remoteVideo: video(),
        caption: "2 SEP 2026 · ABCDEF",
      }),
    );
    return { sent, ...view };
  }

  it("spreads four flashes across four different moments", async () => {
    const { captureFrame } = await import("./capture");
    const { result } = setupWithClock();
    act(() => result.current.setShots(4));
    act(() => result.current.start());

    // Two captures per flash: one of you, one of them.
    await act(async () => void vi.advanceTimersByTime(400 + LEAD_MS));
    expect(captureFrame).toHaveBeenCalledTimes(2);
    await act(async () => void vi.advanceTimersByTime(BETWEEN_MS));
    expect(captureFrame).toHaveBeenCalledTimes(4);
    await act(async () => void vi.advanceTimersByTime(BETWEEN_MS));
    expect(captureFrame).toHaveBeenCalledTimes(6);
    await act(async () => void vi.advanceTimersByTime(BETWEEN_MS));
    expect(captureFrame).toHaveBeenCalledTimes(8);
  });

  it("does not develop the strip before the last photograph is taken", async () => {
    const { paintStrip } = await import("./paint");
    const { result } = setupWithClock();
    act(() => result.current.setShots(4));
    act(() => result.current.start());

    await act(async () => void vi.advanceTimersByTime(400 + LEAD_MS));
    expect(paintStrip).not.toHaveBeenCalled();
    await act(async () => void vi.advanceTimersByTime(BETWEEN_MS * 2));
    expect(paintStrip).not.toHaveBeenCalled();
  });

  it("keeps counting past the two seconds a reaction is allowed", async () => {
    const { result } = setupWithClock();
    act(() => result.current.start());

    await act(async () => void vi.advanceTimersByTime(400 + 5000));
    expect(result.current.count).toBe(2);
  });
});
