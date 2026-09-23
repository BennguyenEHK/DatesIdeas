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
 * A TCP relay and any long path, relayed or direct, need enough headroom for
 * audio to remain conversational. Full video keeps its source resolution here so the
 * encoder spends the smaller budget on a stable picture rather than scaling
 * and re-scaling it.
 */
export const CONSTRAINED_FULL_VIDEO: LeashSettings = {
  maxBitrateBps: 900_000,
  scaleResolutionDownBy: 1,
  maxFramerate: 24,
};

/** Karaoke remains leaner than full video even when both cross a slow path. */
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
 * The tightest budget the call can fall back to when the voice is visibly
 * suffering. Half resolution is accepted here because the alternative is a
 * conversation where every reply arrives a third of a second late.
 */
export const SQUEEZED_FULL_VIDEO: LeashSettings = {
  maxBitrateBps: 450_000,
  scaleResolutionDownBy: 2,
  maxFramerate: 20,
};

/** Karaoke remains leaner than full video even at the tightest level. */
export const SQUEEZED_LEAN_VIDEO: LeashSettings = {
  maxBitrateBps: 300_000,
  scaleResolutionDownBy: 2,
  maxFramerate: 15,
};

/**
 * How hard the camera is being held back: 0 is whatever the route allows,
 * 1 is the constrained budget, 2 is the squeezed one.
 */
export type LeashLevel = 0 | 1 | 2;

/**
 * What the voice is actually experiencing, as measured on the last poll.
 *
 * Preferably what the OTHER side reports about the voice we send them -- the
 * RTCP receiver report -- because that is the only measurement of our own
 * uplink, and our uplink is the one our camera can fill. The numbers about the
 * voice arriving here describe the other person's uplink instead, and are only
 * the fallback for a browser that exposes no receiver report.
 */
export interface LinkHealth {
  /**
   * With `source` "their-report", the RTP interarrival jitter they measured;
   * otherwise the mean time an audio sample waited in our jitter buffer. Both
   * in ms, but they are different quantities on very different scales.
   */
  audioJitterMs: number | null;
  /** Audio packets lost over the last window, as a percentage 0-100. */
  audioLossPct: number | null;
  /** Where the numbers came from. Absent means our own jitter buffer. */
  source?: "their-report" | "our-buffer";
}

/** Buffering beyond this is a voice that is audibly behind the conversation. */
const BUFFER_UP_MS = 150;
/** The voice must be comfortably healthy, not merely acceptable, to loosen. */
const BUFFER_DOWN_MS = 80;
/**
 * Interarrival jitter is a smoothed spread of arrival times, not a buffer
 * length: a healthy call sits at a few milliseconds, and thirty already means
 * packets are queueing behind something. Judging it against the buffer's 150
 * would leave the jitter half of the rule unable to fire at all.
 */
const REPORTED_UP_MS = 30;
const REPORTED_DOWN_MS = 15;
/** Loss beyond this is audible as clipped syllables. */
const LOSS_UP_PCT = 2;
const LOSS_DOWN_PCT = 0.5;

/**
 * One step of the leash's reaction to how the call is actually going.
 *
 * The route rules are a guess made from distance and relay type; this is the
 * correction made from evidence -- ideally from what the other side hears of
 * our voice. A call can sit on a perfectly good-looking route and still have
 * our voice arriving late and clipped at their end, because our camera is
 * filling an uplink nobody can see from the route alone. The gap between the thresholds is deliberate: a level is only given
 * back once the voice is clearly well, so the call does not oscillate between
 * a budget that hurts and one that barely stops hurting.
 */
export function healthStep(
  previous: LeashLevel,
  health: LinkHealth,
): LeashLevel {
  const { audioJitterMs: jitter, audioLossPct: loss } = health;
  const reported = health.source === "their-report";
  const upMs = reported ? REPORTED_UP_MS : BUFFER_UP_MS;
  const downMs = reported ? REPORTED_DOWN_MS : BUFFER_DOWN_MS;
  const struggling =
    (jitter !== null && jitter > upMs) || (loss !== null && loss > LOSS_UP_PCT);
  if (struggling) return previous === 0 ? 1 : 2;

  // Missing readings are not evidence of health, so they cannot loosen it.
  const healthy =
    jitter !== null && jitter < downMs && loss !== null && loss < LOSS_DOWN_PCT;
  if (healthy) return previous === 2 ? 1 : 0;

  return previous;
}

/** How tight the route alone requires the budget to be. */
function routeLevel(route: RouteQuality | null): LeashLevel {
  if (route === null) return 0;
  const distant = route.netRttMs !== null && route.netRttMs > 150;
  if (!route.relayed) return distant ? 1 : 0;
  return route.relayProtocol === "tcp" || distant ? 1 : 0;
}

/**
 * Selects a sender budget from the activity, the path actually carrying media
 * and the level the call's own health has pushed it to. Until ICE has
 * identified that path, retaining the established budget avoids reacting to an
 * incomplete snapshot.
 *
 * Distance counts on a direct route too. Round trip alone does not make a
 * route worse, but a long path is almost always one between two different
 * home connections, and 2.5 Mbps of camera saturates whichever uplink is the
 * smaller. The voice shares that uplink, and the browser pays for the queue by
 * holding every word back in its buffer -- measured at over 300 ms on a direct
 * transpacific call that looked healthy by every other number.
 *
 * The health level can only tighten what the route decided, never loosen it.
 */
export function budgetFor(
  mode: VideoMode,
  route: RouteQuality | null,
  level: LeashLevel = 0,
  capBps: number | null = null,
): LeashSettings {
  const profile = profileFor(mode, route, level);
  return capApplies(route, level) ? capToHeadroom(profile, capBps) : profile;
}

/**
 * Whether the upload estimate is allowed to cap the picture at all.
 *
 * Only once there is evidence of trouble: a relayed route, or a health level
 * that has already stepped up because the other side hears our voice badly.
 * The estimate is Chrome's bandwidth estimate, and when the encoder is held
 * below it the estimate settles near what is actually sent rather than
 * probing upward -- so a cap subtracted from it would feed its own input and
 * ratchet a perfectly healthy direct call down towards the floor, with the
 * rise limit making the climb back slow. A healthy direct call keeps its
 * named budget and never sees the cap.
 */
export function capApplies(route: RouteQuality | null, level: LeashLevel): boolean {
  return level >= 1 || route?.relayed === true;
}

/** The named budget the route and the health level choose, before any cap. */
export function profileFor(
  mode: VideoMode,
  route: RouteQuality | null,
  level: LeashLevel = 0,
): LeashSettings {
  const effective = Math.max(routeLevel(route), level);
  const lean = mode === "lean";

  if (effective === 2) return lean ? SQUEEZED_LEAN_VIDEO : SQUEEZED_FULL_VIDEO;
  if (effective === 1) {
    return lean ? CONSTRAINED_LEAN_VIDEO : CONSTRAINED_FULL_VIDEO;
  }
  if (route === null || !route.relayed) return leashFor(mode);
  return lean ? RELAYED_LEAN_VIDEO : RELAYED_FULL_VIDEO;
}

/** What the voice needs from the upload before the camera gets any of it. */
export const AUDIO_NEED_KBPS = 64;
/** Room left for RTCP, retransmits and the data channels. */
export const HEADROOM_MARGIN_KBPS = 32;
/** The camera is never asked for less than this; below it, it stops making sense. */
export const HEADROOM_FLOOR_BPS = 80_000;
/** Below this a full-size picture only freezes, so it is shrunk instead. */
export const TINY_PICTURE_BELOW_BPS = 250_000;
/** How coarsely the browser's estimate is bucketed before it may decide anything. */
export const HEADROOM_BUCKET_KBPS = 50;

/**
 * The most the camera may send given the browser's own estimate of the
 * upload, in bps -- or null when there is no estimate yet.
 *
 * The named budgets are guesses about a route; this is the measurement. On a
 * relayed evening the browser estimated 145 kbps of room while the camera and
 * voice together were sending 220, and every surplus bit joined a queue that
 * reached a 1.4-second round trip. Whatever the budget said, the link had
 * already said less.
 *
 * Null means only "not measured yet", and the named budget still applies then;
 * it never means uncapped. An estimate below what the voice itself needs
 * gives the floor, not null.
 */
export function headroomCapBps(
  outgoingKbps: number | null,
  audioKbps = AUDIO_NEED_KBPS,
): number | null {
  if (outgoingKbps === null || !Number.isFinite(outgoingKbps)) return null;
  const spareBps = (outgoingKbps - audioKbps - HEADROOM_MARGIN_KBPS) * 1000;
  return Math.max(HEADROOM_FLOOR_BPS, spareBps);
}

/**
 * Lowers a budget to the headroom cap. A cap small enough that a full-size
 * picture would only stall also shrinks the picture and slows it: a tiny live
 * face is better than a large frozen one. Returns the budget itself when the
 * cap does not bind, so the named budgets keep their identity.
 */
export function capToHeadroom(
  budget: LeashSettings,
  capBps: number | null,
): LeashSettings {
  if (capBps === null || capBps >= budget.maxBitrateBps) return budget;
  const tiny = capBps < TINY_PICTURE_BELOW_BPS;
  return {
    maxBitrateBps: capBps,
    scaleResolutionDownBy: tiny
      ? Math.max(budget.scaleResolutionDownBy, 4)
      : budget.scaleResolutionDownBy,
    maxFramerate: tiny
      ? Math.min(budget.maxFramerate, 12)
      : budget.maxFramerate,
  };
}

/** What was last handed to the encoder, and the named budget it came from. */
export interface AppliedLeash {
  profile: LeashSettings;
  settings: LeashSettings;
}

/** A change of capped bitrate smaller than this is not worth a keyframe. */
const CAP_CHANGE_RATIO = 0.2;

/**
 * Whether a new budget is worth reconfiguring a running encoder for.
 *
 * A different named budget, resolution or framerate always is. A bitrate that
 * moved only because the upload estimate wobbled must move by more than a
 * fifth first: the estimate shifts every poll, and each reconfiguration costs
 * a keyframe on exactly the link that has least room for one.
 */
export function leashChanged(
  applied: AppliedLeash | null,
  next: AppliedLeash,
): boolean {
  if (applied === null) return true;
  if (!sameSettings(applied.profile, next.profile)) return true;
  const a = applied.settings;
  const b = next.settings;
  if (
    a.scaleResolutionDownBy !== b.scaleResolutionDownBy ||
    a.maxFramerate !== b.maxFramerate
  ) {
    return true;
  }
  const larger = Math.max(a.maxBitrateBps, b.maxBitrateBps);
  return (
    Math.abs(a.maxBitrateBps - b.maxBitrateBps) > larger * CAP_CHANGE_RATIO
  );
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
const applyEncodingPriority = (
  encoding: EncodingLike,
  priority: string,
): void => {
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

/**
 * Applies one budget to every encoding on a video sender.
 *
 * Deliberately does NOT mark the video as low priority any more. It used to,
 * on the reasoning that the voice should win the link -- but "low" is not a
 * hint to the bandwidth allocator, it is an instruction, and combined with a
 * hard bitrate cap and a demand to hold resolution it can squeeze a camera
 * down to nothing at all. A black rectangle where somebody's face should be is
 * a far worse outcome than a slightly contended one.
 *
 * Raising the voice is enough on its own: applyAudioPriority still asks for
 * "high", so audio outranks video without video being told to give way.
 */
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
  level: LeashLevel = 0,
  capBps: number | null = null,
): Promise<number> {
  const settings = budgetFor(mode, route, level, capBps);
  const results = await Promise.all(
    senders.map((sender) => applyLeash(sender, settings)),
  );
  return results.filter((applied) => applied).length;
}

/** Where the health reaction stands between two stats polls. */
export interface LeashHealthState {
  level: LeashLevel;
  /** The direction the previous poll wanted to move in: -1 looser, 1 tighter. */
  pending: -1 | 0 | 1;
  /**
   * When the level or the headroom cap last moved, or null when neither has.
   * Shared, so that loosening either one waits out a move of the other.
   */
  movedAtMs: number | null;
  /** The bucketed upload estimate the cap is built from, or null before one. */
  capKbps: number | null;
}

export const INITIAL_LEASH_HEALTH: LeashHealthState = {
  level: 0,
  pending: 0,
  movedAtMs: null,
  capKbps: null,
};

/** A change of level costs a keyframe, so it may not happen more often than this. */
export const LEASH_MOVE_COOLDOWN_MS = 15_000;

/**
 * Advances the health reaction by one stats poll.
 *
 * A single poll is a three-second window, and one bad window is as likely to
 * be a microwave or a neighbour's download as a real change in the link. So a
 * move needs two consecutive polls asking for it in the same direction, and
 * even then the level may shift only one step per cooldown: each shift is a
 * reconfiguration and a keyframe, and a leash that jerks back and forth is its
 * own source of the congestion it is meant to relieve.
 */
export function advanceLeashHealth(
  state: LeashHealthState,
  health: LinkHealth,
  nowMs: number,
): LeashHealthState {
  const proposed = healthStep(state.level, health);
  const direction = Math.sign(proposed - state.level) as -1 | 0 | 1;
  if (direction === 0) {
    return state.pending === 0 ? state : { ...state, pending: 0 };
  }

  const confirmed = state.pending === direction;
  const cooledDown =
    state.movedAtMs === null ||
    nowMs - state.movedAtMs >= LEASH_MOVE_COOLDOWN_MS;
  if (confirmed && cooledDown) {
    return { ...state, level: proposed, pending: 0, movedAtMs: nowMs };
  }
  return { ...state, pending: direction };
}

/**
 * Advances the upload-estimate cap by one stats poll.
 *
 * The estimate is bucketed first, so a reading wobbling around one value does
 * not look like movement. A lower bucket is adopted at once -- the link has
 * already shrunk, and every poll spent above it is queue. A higher one waits
 * out the cooldown shared with the health level, so the cap cannot climb back
 * the moment a single poll looks better. A missing estimate keeps the cap
 * where it was rather than lifting it.
 */
export function advanceHeadroom(
  state: LeashHealthState,
  outgoingKbps: number | null,
  nowMs: number,
): LeashHealthState {
  if (outgoingKbps === null || !Number.isFinite(outgoingKbps)) return state;
  const bucket =
    Math.round(outgoingKbps / HEADROOM_BUCKET_KBPS) * HEADROOM_BUCKET_KBPS;
  if (state.capKbps === bucket) return state;

  const rising = state.capKbps !== null && bucket > state.capKbps;
  if (rising) {
    const cooledDown =
      state.movedAtMs === null ||
      nowMs - state.movedAtMs >= LEASH_MOVE_COOLDOWN_MS;
    if (!cooledDown) return state;
  }
  // The very first estimate is adopted without stamping the cooldown: it is
  // the starting point, not a move, and must not hold back the health level.
  const first = state.capKbps === null;
  return {
    ...state,
    capKbps: bucket,
    movedAtMs: first ? state.movedAtMs : nowMs,
  };
}
