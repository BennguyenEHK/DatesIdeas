/**
 * What the microphone actually became, as opposed to what it was asked to be.
 *
 * Every audio profile in this app is a request. `applyConstraints` returns a
 * promise that resolves when the browser has considered it, which is not the
 * same as having honoured it, and a device is free to report success while
 * changing nothing at all. Until this module existed nothing ever looked: the
 * profile was set, the failure path was swallowed on purpose, and a microphone
 * still running full speech processing through a whole evening of singing was
 * indistinguishable from one tuned exactly as intended.
 *
 * That distinction is the difference between two completely different bugs, so
 * it is worth reading the answer back rather than assuming it.
 */

/** The narrowest shape needed, so this is testable against a plain object. */
export interface SettingsTrackLike {
  getSettings?: () => MediaTrackSettings;
}

export interface MicSettings {
  echoCancellation: boolean | null;
  noiseSuppression: boolean | null;
  autoGainControl: boolean | null;
  /**
   * The operating system's own voice isolation, where the browser exposes it.
   *
   * Worth its own field because it sits BELOW everything this app can set.
   * Windows Studio Effects and its equivalents are built to keep a talking
   * voice and discard everything else, and a sustained sung note is exactly
   * the kind of signal they are designed to remove.
   */
  voiceIsolation: boolean | null;
  channelCount: number | null;
  sampleRate: number | null;
}

/** The three flags this app actually asks about, in the order it sets them. */
const PROCESSING = [
  "echoCancellation",
  "noiseSuppression",
  "autoGainControl",
] as const;

const bool = (v: unknown): boolean | null =>
  typeof v === "boolean" ? v : null;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** Reads the settled state of a live track, or null when it cannot be read. */
export function readMicSettings(track: SettingsTrackLike): MicSettings | null {
  if (typeof track.getSettings !== "function") return null;

  let raw: Record<string, unknown>;
  try {
    raw = track.getSettings() as unknown as Record<string, unknown>;
  } catch {
    // Some builds expose the method and refuse the call. An unreadable
    // microphone is a gap in the evidence, not a broken call.
    return null;
  }

  return {
    echoCancellation: bool(raw.echoCancellation),
    noiseSuppression: bool(raw.noiseSuppression),
    autoGainControl: bool(raw.autoGainControl),
    voiceIsolation: bool(raw.voiceIsolation),
    channelCount: num(raw.channelCount),
    sampleRate: num(raw.sampleRate),
  };
}

/**
 * Which requested processing flags the device did not actually adopt.
 *
 * A flag counts as unmet only when both sides are known and they disagree. A
 * browser that never reports the field is being silent rather than disobedient,
 * and calling that a refusal would send someone hunting a fault that may not be
 * there at all.
 */
export function unmetRequests(
  requested: MediaTrackConstraints,
  actual: MicSettings | null,
): string[] {
  if (actual === null) return [];

  const unmet: string[] = [];
  for (const flag of PROCESSING) {
    const asked = bool(requested[flag]);
    const got = actual[flag];
    if (asked !== null && got !== null && asked !== got) unmet.push(flag);
  }
  return unmet;
}

/** The settled microphone as one short human-readable phrase. */
export function describeMic(settings: MicSettings | null): string {
  if (settings === null) return "unknown";

  const parts: string[] = [];
  const onOff = (v: boolean | null): string => (v === true ? "on" : "off");

  if (settings.echoCancellation !== null) parts.push(`aec ${onOff(settings.echoCancellation)}`);
  if (settings.noiseSuppression !== null) parts.push(`ns ${onOff(settings.noiseSuppression)}`);
  if (settings.autoGainControl !== null) parts.push(`agc ${onOff(settings.autoGainControl)}`);
  if (settings.channelCount !== null) {
    parts.push(settings.channelCount >= 2 ? "stereo" : "mono");
  }
  if (settings.sampleRate !== null) parts.push(`${settings.sampleRate}Hz`);
  // Only when switched on. Off is the ordinary case and saying so every time
  // would bury the one reading anybody needs to notice.
  if (settings.voiceIsolation === true) parts.push("voice isolation ON");

  return parts.join(", ");
}
