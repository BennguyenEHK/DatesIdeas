/** "full" is every other activity; "lean" is karaoke. */
export type VideoMode = "full" | "lean";

export interface LeashSettings {
  /** Bits per second. */
  maxBitrateBps: number;
  /** 1 = native resolution, 2 = half width and half height. */
  scaleResolutionDownBy: number;
  maxFramerate: number;
}

/** Describes the selected ICE path well enough to choose a sender budget. */
export interface RouteQuality {
  relayed: boolean;
  /** "udp" | "tcp" | "tls" | null */
  relayProtocol: string | null;
  /** ICE RTT in ms, or null when not yet measured. */
  netRttMs: number | null;
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

/**
 * A TCP relay and a long relay path both need enough headroom for audio to
 * remain conversational. Full video keeps its source resolution here so the
 * encoder spends the smaller budget on a stable picture rather than scaling
 * and re-scaling it.
 */
export const CONSTRAINED_FULL_VIDEO: LeashSettings = {
  maxBitrateBps: 900_000,
  scaleResolutionDownBy: 1,
  maxFramerate: 24,
};

/** Karaoke remains leaner than full video even when both cross a slow relay. */
export const CONSTRAINED_LEAN_VIDEO: LeashSettings = {
  maxBitrateBps: 400_000,
  scaleResolutionDownBy: 2,
  maxFramerate: 20,
};

/** A close UDP or TLS relay still merits a little room for audio and retransmits. */
export const RELAYED_FULL_VIDEO: LeashSettings = {
  maxBitrateBps: 1_500_000,
  scaleResolutionDownBy: 1,
  maxFramerate: 28,
};

/** Karaoke remains leaner than full video on a close relayed route. */
export const RELAYED_LEAN_VIDEO: LeashSettings = {
  maxBitrateBps: 450_000,
  scaleResolutionDownBy: 2,
  maxFramerate: 22,
};

/** Selects the camera budget for the current activity. */
export function leashFor(mode: VideoMode): LeashSettings {
  return mode === "lean" ? LEAN_VIDEO : FULL_VIDEO;
}

/**
 * Whether two budgets would tell the encoder exactly the same thing.
 *
 * The route these are derived from carries a live RTT measurement, and that
 * measurement wobbles by tens of milliseconds from one poll to the next. Two
 * readings a hundred milliseconds apart routinely describe the same relayed,
 * slow, TCP-carried path -- the same decision, reached twice.
 *
 * Acting on the second one is not free. setParameters on a running sender
 * reconfigures the encoder and costs a keyframe, and a keyframe every few
 * seconds is a bandwidth spike repeated forever on a link that was already too
 * small for the call. Anything else sharing that link -- a film being buffered
 * from YouTube, for instance -- pays for it.
 *
 * So the comparison is on what actually reaches the encoder, not on the
 * measurement it was computed from.
 */
export function sameSettings(a: LeashSettings, b: LeashSettings): boolean {
  return (
    a.maxBitrateBps === b.maxBitrateBps &&
    a.scaleResolutionDownBy === b.scaleResolutionDownBy &&
    a.maxFramerate === b.maxFramerate
  );
}

/**
 * Selects a sender budget from the activity and the path actually carrying
 * media. Until ICE has identified that path, retaining the established budget
 * avoids reacting to an incomplete snapshot.
 */
export function budgetFor(
  mode: VideoMode,
  route: RouteQuality | null,
): LeashSettings {
  if (route === null || !route.relayed) return leashFor(mode);

  if (route.relayProtocol === "tcp" || (route.netRttMs !== null && route.netRttMs > 150)) {
    return mode === "lean" ? CONSTRAINED_LEAN_VIDEO : CONSTRAINED_FULL_VIDEO;
  }

  return mode === "lean" ? RELAYED_LEAN_VIDEO : RELAYED_FULL_VIDEO;
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
  networkPriority?: string;
  priority?: string;
}

export interface SenderParamsLike {
  encodings?: EncodingLike[];
  degradationPreference?: string;
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

/**
 * Asks for this encoding to be treated as more or less urgent than its peers.
 *
 * Both names are written because browsers disagree about which one they read,
 * and one that reads neither simply ignores the extra properties.
 *
 * Each write is guarded separately, and the guards are not theoretical: a
 * parameters object is not always the plain dictionary it looks like, and a
 * build that exposes one of these as a rejecting accessor would otherwise take
 * the bitrate cap down with it. Priority is a nicety. The cap is the point, and
 * nothing optional may be allowed to stand in front of it.
 */
const applyEncodingPriority = (encoding: EncodingLike, priority: string): void => {
  try {
    encoding.networkPriority = priority;
  } catch {
    // This build refuses the newer name; the older one below may still land.
  }
  try {
    encoding.priority = priority;
  } catch {
    // Neither name is available. The budget still applies, unprioritised.
  }
};

/** Applies one budget to every encoding on a video sender. */
export async function applyLeash(
  sender: SenderLike,
  settings: LeashSettings,
): Promise<boolean> {
  if (sender.track === null || sender.track.kind !== "video") return false;

  const params = sender.getParameters();
  const encodings = params.encodings;
  if (encodings === undefined || encodings.length === 0) {
    const encoding = encodingFor(settings);
    applyEncodingPriority(encoding, "low");
    params.encodings = [encoding];
  } else {
    for (const encoding of encodings) {
      encoding.maxBitrate = settings.maxBitrateBps;
      encoding.scaleResolutionDownBy = settings.scaleResolutionDownBy;
      encoding.maxFramerate = settings.maxFramerate;
      applyEncodingPriority(encoding, "low");
    }
  }

  // Asks the encoder to sacrifice framerate before resolution. A call between
  // two faces and a film wants one steady picture far more than it wants the
  // extra frames, and the reported symptom was exactly the opposite trade:
  // bitrate being poured into a picture that kept collapsing to 360p.
  let preferenceSet = false;
  try {
    params.degradationPreference = "maintain-resolution";
    preferenceSet = true;
  } catch {
    // This build will not accept the hint. Only the hint is lost.
  }

  // The browser's transactionId belongs to this exact object from getParameters;
  // rebuilding it can make setParameters silently reject the quality change.
  try {
    await sender.setParameters(params);
    return true;
  } catch {
    // The preference is a hint; the cap is the point. A browser that dislikes
    // the hint rejects the WHOLE call, which would leave the camera running
    // completely uncapped by the code meant to cap it. So give up the nicety
    // and ask once more for the part that matters.
    if (!preferenceSet) return false;
    try {
      delete params.degradationPreference;
    } catch {
      return false;
    }
    try {
      await sender.setParameters(params);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Gives audio first claim on the relay queue where the browser exposes sender
 * priorities. The same parameter object must be reused for the transaction
 * for the reason described in applyLeash above.
 */
export async function applyAudioPriority(sender: SenderLike): Promise<boolean> {
  if (sender.track === null || sender.track.kind !== "audio") return false;

  const params = sender.getParameters();
  const encodings = params.encodings;
  if (encodings === undefined || encodings.length === 0) {
    const encoding: EncodingLike = {};
    applyEncodingPriority(encoding, "high");
    params.encodings = [encoding];
  } else {
    for (const encoding of encodings) applyEncodingPriority(encoding, "high");
  }

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
  route: RouteQuality | null = null,
): Promise<number> {
  const settings = budgetFor(mode, route);
  const results = await Promise.all(
    senders.map((sender) => applyLeash(sender, settings)),
  );
  return results.filter((applied) => applied).length;
}
