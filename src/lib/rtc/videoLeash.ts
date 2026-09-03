/** "full" is every other activity; "lean" is karaoke. */
export type VideoMode = "full" | "lean";

export interface LeashSettings {
  /** Bits per second. */
  maxBitrateBps: number;
  /** 1 = native resolution, 2 = half width and half height. */
  scaleResolutionDownBy: number;
  maxFramerate: number;
}

export const FULL_VIDEO: LeashSettings = {
  maxBitrateBps: 2_500_000,
  scaleResolutionDownBy: 1,
  maxFramerate: 30,
};

export const LEAN_VIDEO: LeashSettings = {
  maxBitrateBps: 500_000,
  scaleResolutionDownBy: 2,
  maxFramerate: 24,
};

/** Selects the camera budget for the current activity. */
export function leashFor(mode: VideoMode): LeashSettings {
  return mode === "lean" ? LEAN_VIDEO : FULL_VIDEO;
}

/**
 * The narrowest shape of a sender this module needs, so it can be tested
 * against a fake rather than a live peer connection.
 *
 * Deliberately WITHOUT an index signature. One here would look harmless and
 * would quietly stop a real RTCRtpSender being assignable to SenderLike at
 * all — the built-in parameter types have no index signature of their own —
 * which is a compile error at the only call site that matters.
 */
export interface EncodingLike {
  maxBitrate?: number;
  scaleResolutionDownBy?: number;
  maxFramerate?: number;
}

export interface SenderParamsLike {
  encodings?: EncodingLike[];
}

export interface SenderLike {
  track: { kind: string } | null;
  getParameters(): SenderParamsLike;
  setParameters(params: SenderParamsLike): Promise<void>;
}

const encodingFor = (settings: LeashSettings): EncodingLike => ({
  maxBitrate: settings.maxBitrateBps,
  scaleResolutionDownBy: settings.scaleResolutionDownBy,
  maxFramerate: settings.maxFramerate,
});

/** Applies one budget to every encoding on a video sender. */
export async function applyLeash(
  sender: SenderLike,
  settings: LeashSettings,
): Promise<boolean> {
  if (sender.track === null || sender.track.kind !== "video") return false;

  const params = sender.getParameters();
  const encodings = params.encodings;
  if (encodings === undefined || encodings.length === 0) {
    params.encodings = [encodingFor(settings)];
  } else {
    for (const encoding of encodings) {
      encoding.maxBitrate = settings.maxBitrateBps;
      encoding.scaleResolutionDownBy = settings.scaleResolutionDownBy;
      encoding.maxFramerate = settings.maxFramerate;
    }
  }

  // The browser's transactionId belongs to this exact object from getParameters;
  // rebuilding it can make setParameters silently reject the quality change.
  try {
    await sender.setParameters(params);
    return true;
  } catch {
    return false;
  }
}

/** Applies a mode to all video senders and counts successful changes. */
export async function leashSenders(
  senders: readonly SenderLike[],
  mode: VideoMode,
): Promise<number> {
  const settings = leashFor(mode);
  const results = await Promise.all(
    senders.map((sender) => applyLeash(sender, settings)),
  );
  return results.filter((applied) => applied).length;
}
