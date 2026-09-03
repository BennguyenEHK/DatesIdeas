import { describe, expect, it, vi } from "vitest";

const { startRecording } = vi.hoisted(() => ({ startRecording: vi.fn() }));
vi.mock("./record", () => ({ startRecording }));

import { buildLiveStrip, LIVE_STRIP_WIDTH, MAX_LIVE_STRIP_MS, type PlayableVideo } from "./liveStrip";
import { stripLayout } from "./strip";
import { theme } from "./themes";

type Call = [string, ...unknown[]];
class Context {
  readonly calls: Call[] = [];
  fillStyle: string | CanvasGradient = "#000"; strokeStyle: string | CanvasGradient = "#000";
  lineWidth = 1; font = ""; textAlign: CanvasTextAlign = "start"; textBaseline: CanvasTextBaseline = "alphabetic";
  globalAlpha = 1; globalCompositeOperation: GlobalCompositeOperation = "source-over"; filter = "none";
  save() { this.calls.push(["save"]); } restore() { this.calls.push(["restore"]); }
  createLinearGradient() { return { addColorStop: () => undefined } as CanvasGradient; }
  createRadialGradient() { return { addColorStop: () => undefined } as CanvasGradient; }
  fillRect(...a: number[]) { this.calls.push(["fillRect", ...a]); } strokeRect(...a: number[]) { this.calls.push(["strokeRect", ...a]); }
  drawImage(image: CanvasImageSource, ...a: number[]) { this.calls.push(["drawImage", image, ...a]); }
  beginPath() {} arc() {} fill() {} fillText(...a: [string, number, number]) { this.calls.push(["fillText", ...a]); }
}
class Video implements PlayableVideo {
  readyState = 4; videoWidth = 1600; videoHeight = 900; currentTime = 0; loop = false; muted = false; src: string;
  paused = 0; removed = 0; constructor(src: string, private readonly reject = false) { this.src = src; }
  play() { return this.reject ? Promise.reject(new Error("no autoplay")) : Promise.resolve(); }
  pause() { this.paused++; } remove() { this.removed++; }
}
function setup(options: { urls?: readonly (string | null)[]; duration?: number; videos?: Video[]; clip?: unknown; recording?: "default" | "null" } = {}) {
  const context = new Context(); const frames: Array<() => void> = []; let clock = 0;
  const videos = options.videos ?? [];
  const canvas = { getContext: () => context } as unknown as HTMLCanvasElement;
  const stop = vi.fn().mockResolvedValue(options.clip === undefined ? { blob: new Blob(), mimeType: "video/webm", durationMs: 1 } : options.clip);
  startRecording.mockReturnValue(options.recording === "null" ? null : { stop, cancel: vi.fn() });
  const makeCanvas = vi.fn(() => canvas); const revoke = vi.fn(); const cancelFrame = vi.fn();
  const result = buildLiveStrip({ clipUrls: options.urls ?? ["one", "two"], shots: 2, theme: theme("griffith"), caption: "Last", durationMs: options.duration ?? 100 }, {
    makeCanvas, makeVideo: vi.fn((src) => videos.shift() ?? new Video(src)), onFrame: (fn) => { frames.push(fn); return frames.length; }, cancelFrame, now: () => clock, revoke,
  });
  return { result, context, frames, makeCanvas, revoke, cancelFrame, stop, setTime: (value: number) => { clock = value; } };
}
async function frame(s: ReturnType<typeof setup>, time: number) { s.setTime(time); const next = s.frames.shift(); if (next) next(); await Promise.resolve(); }

describe("buildLiveStrip", () => {
  it("returns null without creating a canvas when every URL is null", async () => { const s = setup({ urls: [null, null] }); await expect(s.result).resolves.toBeNull(); expect(s.makeCanvas).not.toHaveBeenCalled(); });
  it("uses the exact live layout canvas size", async () => { const s = setup(); await Promise.resolve(); expect(s.makeCanvas).toHaveBeenCalledWith(...[stripLayout(2, LIVE_STRIP_WIDTH).width, stripLayout(2, LIVE_STRIP_WIDTH).height]); await frame(s, 100); await s.result; });
  it("draws each playable clip once into its whole panel", async () => { const a = new Video("one"); const b = new Video("two"); const s = setup({ videos: [a, b] }); await Promise.resolve(); await frame(s, 0); const layout = stripLayout(2, LIVE_STRIP_WIDTH); const draws = s.context.calls.filter(([n, image]) => n === "drawImage" && (image === a || image === b)); expect(draws).toHaveLength(2); for (const [index, draw] of draws.entries()) { const panel = layout.panels[index]; expect(draw.slice(-4)).toEqual([panel.x, panel.y, panel.width, panel.height]); expect(draw[2] as number).toBeCloseTo(0); expect(draw[4] as number).toBeCloseTo(1600); } await frame(s, 100); await s.result; });
  it("skips a not-ready video then draws it once ready", async () => { const v = new Video("one"); v.readyState = 1; const s = setup({ urls: ["one", null], videos: [v] }); await Promise.resolve(); await frame(s, 0); expect(s.context.calls.some(([n, image]) => n === "drawImage" && image === v)).toBe(false); v.readyState = 4; await frame(s, 1); expect(s.context.calls.some(([n, image]) => n === "drawImage" && image === v)).toBe(true); await frame(s, 100); await s.result; });
  it("keeps other panels when play is rejected", async () => { const bad = new Video("one", true); const good = new Video("two"); const s = setup({ videos: [bad, good] }); await Promise.resolve(); await frame(s, 0); expect(s.context.calls.some(([n, image]) => n === "drawImage" && image === bad)).toBe(false); expect(s.context.calls.some(([n, image]) => n === "drawImage" && image === good)).toBe(true); await frame(s, 100); await s.result; });
  it("stops at the requested duration", async () => { const s = setup({ duration: 50 }); await frame(s, 0); expect(s.stop).not.toHaveBeenCalled(); await frame(s, 50); await s.result; expect(s.stop).toHaveBeenCalledOnce(); });
  it("clamps the running duration to the cap", async () => { const s = setup({ duration: MAX_LIVE_STRIP_MS + 1 }); await frame(s, MAX_LIVE_STRIP_MS - 1); expect(s.stop).not.toHaveBeenCalled(); await frame(s, MAX_LIVE_STRIP_MS); await s.result; expect(s.stop).toHaveBeenCalledOnce(); });
  it("revokes every URL after success", async () => { const s = setup(); await frame(s, 100); await s.result; expect(s.revoke).toHaveBeenCalledWith("one"); expect(s.revoke).toHaveBeenCalledWith("two"); });
  it("revokes URLs when recording returns null", async () => { const s = setup({ recording: "null" }); await expect(s.result).resolves.toBeNull(); expect(s.revoke).toHaveBeenCalledTimes(2); });
  it("pauses, clears, and removes videos after recording", async () => { const v = new Video("one"); const s = setup({ urls: ["one", null], videos: [v] }); await frame(s, 100); await s.result; expect([v.paused, v.src, v.removed]).toEqual([1, "", 1]); });
  it("paints the caption last", async () => { const s = setup(); await Promise.resolve(); await frame(s, 0); expect(s.context.calls.at(-2)?.[0]).toBe("fillText"); await frame(s, 100); await s.result; });
  it("sets loop and mute before playback", async () => { const v = new Video("one"); const s = setup({ urls: ["one", null], videos: [v] }); await Promise.resolve(); expect([v.loop, v.muted]).toEqual([true, true]); await frame(s, 100); await s.result; });
  it("does not draw a zero-sized video", async () => { const v = new Video("one"); v.videoWidth = 0; const s = setup({ urls: ["one", null], videos: [v] }); await Promise.resolve(); await frame(s, 0); expect(s.context.calls.some(([n, image]) => n === "drawImage" && image === v)).toBe(false); await frame(s, 100); await s.result; });
  it("cancels the pending frame during cleanup", async () => { const s = setup(); await frame(s, 0); await frame(s, 100); await s.result; expect(s.cancelFrame).toHaveBeenCalled(); });
  it("returns the clip supplied by the recorder", async () => { const clip = { blob: new Blob(), mimeType: "video/webm", durationMs: 9 }; const s = setup({ clip }); await frame(s, 100); await expect(s.result).resolves.toBe(clip); });
  it("returns null supplied by the recorder", async () => { const s = setup({ clip: null }); await frame(s, 100); await expect(s.result).resolves.toBeNull(); });
});
