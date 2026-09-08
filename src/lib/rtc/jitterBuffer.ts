export type BufferKind = "audio" | "video";

export interface BufferRoute {
  relayed: boolean;
  relayProtocol: string | null;
  netRttMs: number | null;
}

export interface ReceiverLike {
  jitterBufferTarget?: number | null;
}

/**
 * The audio target that holds an intercontinental call steady without asking
 * the browser to operate a buffer too small for the route it is on.
 */
export const AUDIO_JITTER_TARGET_MS = 180;

/**
 * Video can wait a little longer than the voice. Giving it that room keeps a
 * dropped frame from becoming a visible stutter without holding speech back.
 */
export const VIDEO_JITTER_TARGET_MS = 240;

/**
 * Singing together needs the smallest buffer that remains dependable. Half
 * the normal target is a meaningful reduction while still avoiding the zero
 * request that makes a rough route oscillate.
 */
export const DUETTING_JITTER_TARGET_FACTOR = 0.5;

/**
 * A target above this is no longer a useful recovery margin. It only turns a
 * momentary delivery problem into a long, confusing delay for both people.
 */
export const MAX_JITTER_TARGET_MS = 500;

// The measured call remains on its stable base target. Only a route far beyond
// that range is given extra room, and even then the public maximum is absolute.
const EXTRA_BUFFER_RTT_MS = 500;

/**
 * How much more margin a relay reached over TCP needs than one reached over UDP.
 *
 * TCP will not drop a late packet. It holds everything queued behind the
 * straggler until a retransmit arrives and the stream can be handed over in
 * order. What would be one missing frame on UDP is therefore a stall of
 * everything behind it here, and covering a retransmit takes more room than
 * covering a hiccup. TLS is carried over TCP and inherits the same behaviour.
 */
export const TCP_RELAY_EXTRA_MS = 60;

const overTcp = (relayProtocol: string | null): boolean =>
  relayProtocol === "tcp" || relayProtocol === "tls";

/**
 * Milliseconds to request, or null to leave the browser's own default.
 *
 * A zero target is helpful only on a direct, fast route. On a relay or a slow
 * direct path it asks the browser to run without the margin it needs, so the
 * browser repeatedly grows and drains the buffer instead of keeping one stable
 * amount of delay. Duetting trims that stable margin, but never removes it.
 */
export function jitterTargetMs(
  kind: BufferKind,
  route: BufferRoute | null,
  duetting: boolean,
): number | null {
  if (route === null) return null;

  if (!route.relayed && (route.netRttMs === null || route.netRttMs <= 150)) {
    return 0;
  }

  const base = kind === "audio" ? AUDIO_JITTER_TARGET_MS : VIDEO_JITTER_TARGET_MS;
  const extra =
    route.netRttMs !== null && Number.isFinite(route.netRttMs)
      ? Math.max(0, route.netRttMs - EXTRA_BUFFER_RTT_MS) / 4
      : 0;
  const retransmits = route.relayed && overTcp(route.relayProtocol)
    ? TCP_RELAY_EXTRA_MS
    : 0;
  const target = Math.min(MAX_JITTER_TARGET_MS, base + extra + retransmits);

  return duetting ? target * DUETTING_JITTER_TARGET_FACTOR : target;
}

/**
 * Applies a measured policy decision when this browser supports the property.
 *
 * Browsers that do not expose it must keep their own default, and a few builds
 * expose it but refuse a write. Both cases are normal compatibility outcomes,
 * not failures for the caller to surface.
 */
export function applyJitterTarget(receiver: ReceiverLike, ms: number | null): boolean {
  if (ms === null || !("jitterBufferTarget" in receiver)) return false;

  try {
    receiver.jitterBufferTarget = ms;
    return true;
  } catch {
    return false;
  }
}
