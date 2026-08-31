export const FALLBACK_ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

export interface IceResult {
  iceServers: RTCIceServer[];
  /** Set when TURN was unavailable — the UI surfaces this rather than hiding it. */
  degraded?: string;
}

export async function fetchIceServers(): Promise<IceResult> {
  try {
    const res = await fetch("/api/turn");
    const body = (await res.json()) as IceResult;
    if (!Array.isArray(body.iceServers) || body.iceServers.length === 0) {
      return { iceServers: FALLBACK_ICE_SERVERS, degraded: "turn-empty" };
    }
    return body;
  } catch {
    return { iceServers: FALLBACK_ICE_SERVERS, degraded: "turn-fetch-failed" };
  }
}
