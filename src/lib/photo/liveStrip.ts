import { startRecording, type Clip } from "./record";
import { paintFinish, paintScene } from "./paint";
import { stripLayout, type ShotCount } from "./strip";
import type { Theme } from "./themes";

/** How wide the moving strip is rendered. Smaller than the still strip,
 *  because every frame repaints the whole thing and nobody watches a live
 *  photo at print resolution. */
export const LIVE_STRIP_WIDTH = 540;

/** Longest a moving strip may run, however long the clips are. */
export const MAX_LIVE_STRIP_MS = 12_000;

/** The minimal shape of a playable clip source, so this is testable. */
export interface PlayableVideo {
  readonly readyState: number;
  readonly videoWidth: number;
  readonly videoHeight: number;
  currentTime: number;
  loop: boolean;
  muted: boolean;
  play(): Promise<void>;
  pause(): void;
  src: string;
  remove?(): void;
}

export interface LiveStripDeps {
  /** Builds a playable element from an object URL. Injected for testing. */
  makeVideo: (src: string) => PlayableVideo;
  /** Creates the canvas that gets filmed. Injected for testing. */
  makeCanvas: (width: number, height: number) => HTMLCanvasElement;
  /** Schedules the next painted frame. Injected for testing. */
  onFrame: (fn: () => void) => number;
  cancelFrame: (handle: number) => void;
  now: () => number;
  revoke: (url: string) => void;
}

export interface LiveStripInput {
  /** One object URL per shot, in shot order. Null where no clip exists. */
  clipUrls: readonly (string | null)[];
  shots: ShotCount;
  theme: Theme;
  caption: string;
  /** How long to run for, clamped to MAX_LIVE_STRIP_MS. */
  durationMs: number;
}

interface VideoPanel {
  video: PlayableVideo;
  panelIndex: number;
  canDraw: boolean;
}

function cropVideo(
  ctx: CanvasRenderingContext2D,
  video: PlayableVideo,
  dest: { x: number; y: number; width: number; height: number },
): void {
  if (video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0) return;

  const sourceAspect = video.videoWidth / video.videoHeight;
  const destinationAspect = dest.width / dest.height;
  let sx = 0;
  let sy = 0;
  let sw = video.videoWidth;
  let sh = video.videoHeight;
  if (sourceAspect > destinationAspect) {
    sw = sh * destinationAspect;
    sx = (video.videoWidth - sw) / 2;
  } else {
    sh = sw / destinationAspect;
    sy = (video.videoHeight - sh) / 2;
  }
  ctx.drawImage(video as unknown as CanvasImageSource, sx, sy, sw, sh, dest.x, dest.y, dest.width, dest.height);
}

function runFor(durationMs: number): number {
  if (!Number.isFinite(durationMs)) return 0;
  return Math.min(Math.max(0, durationMs), MAX_LIVE_STRIP_MS);
}

/**
 * Plays every clip at once into one strip-shaped canvas and films the result.
 * Resolves null when there is nothing usable to stitch.
 */
export async function buildLiveStrip(
  input: LiveStripInput,
  deps: LiveStripDeps,
): Promise<Clip | null> {
  const urls = input.clipUrls.filter((url): url is string => url !== null);
  if (urls.length === 0) return null;

  const layout = stripLayout(input.shots, LIVE_STRIP_WIDTH);
  const videos: VideoPanel[] = [];
  let frame: number | null = null;

  try {
    const canvas = deps.makeCanvas(layout.width, layout.height);
    const ctx = canvas.getContext("2d");
    if (ctx === null) return null;

    input.clipUrls.forEach((url, panelIndex) => {
      if (url === null) return;
      try {
        const video = deps.makeVideo(url);
        video.loop = true;
        video.muted = true;
        const entry: VideoPanel = { video, panelIndex, canDraw: false };
        videos.push(entry);
        video.play().then(
          () => { entry.canDraw = true; },
          () => { /* A declined autoplay leaves only this panel as scenery. */ },
        );
      } catch {
        // A malformed object URL is one missing photograph, not a failed strip.
      }
    });

    const recording = startRecording(canvas, { now: deps.now });
    if (recording === null) return null;

    const startedAt = deps.now();
    const duration = runFor(input.durationMs);
    return await new Promise<Clip | null>((resolve) => {
      const finish = (): void => {
        if (frame !== null) deps.cancelFrame(frame);
        frame = null;
        void recording.stop().then(resolve, () => resolve(null));
      };
      const paint = (): void => {
        if (deps.now() - startedAt >= duration) {
          finish();
          return;
        }

        paintScene(ctx, input.theme, layout);
        for (const entry of videos) {
          const panel = layout.panels[entry.panelIndex];
          if (entry.canDraw && panel !== undefined) cropVideo(ctx, entry.video, panel);
        }
        paintFinish(ctx, input.theme, layout, layout.panels);

        ctx.save();
        ctx.strokeStyle = input.theme.frame;
        ctx.lineWidth = Math.max(1, layout.width * 0.008);
        const inset = ctx.lineWidth / 2;
        ctx.strokeRect(inset, inset, layout.width - ctx.lineWidth, layout.height - ctx.lineWidth);
        ctx.restore();

        ctx.save();
        ctx.fillStyle = input.theme.ink;
        ctx.font = `${Math.max(1, layout.caption.height * 0.48)}px "Poiret One", Georgia, serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(input.caption, layout.caption.x + layout.caption.width / 2, layout.caption.y + layout.caption.height / 2);
        ctx.restore();

        frame = deps.onFrame(paint);
      };
      frame = deps.onFrame(paint);
    });
  } finally {
    if (frame !== null) deps.cancelFrame(frame);
    for (const entry of videos) {
      try { entry.video.pause(); } catch { /* Releasing the other clips still matters. */ }
      try { entry.video.src = ""; } catch { /* A partial video element can still be removed. */ }
      try { entry.video.remove?.(); } catch { /* Object URL cleanup below is the important release. */ }
    }
    for (const url of urls) deps.revoke(url);
  }
}
