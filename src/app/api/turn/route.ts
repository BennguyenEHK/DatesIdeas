import { NextResponse } from "next/server";

export const runtime = "edge";
/** Credentials are per-request and short-lived; caching them would be wrong. */
export const dynamic = "force-dynamic";

const TTL_SECONDS = 7200;

/**
 * Public STUN only. Enough to establish a direct connection on friendly
 * networks; a symmetric-NAT peer will fail to connect with just this, which
 * is why the UI must surface the degraded state rather than hide it.
 */
export const FALLBACK_ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

export async function GET() {
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const token = process.env.CLOUDFLARE_TURN_API_TOKEN;

  if (!keyId || !token) {
    return NextResponse.json(
      { iceServers: FALLBACK_ICE_SERVERS, degraded: "turn-unconfigured" },
      { status: 503 },
    );
  }

  try {
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl: TTL_SECONDS }),
      },
    );

    if (!res.ok) {
      // Deliberately does not echo the upstream body — it may contain the token.
      return NextResponse.json(
        { iceServers: FALLBACK_ICE_SERVERS, degraded: "turn-upstream-error" },
        { status: 502 },
      );
    }

    return NextResponse.json(await res.json(), { status: 200 });
  } catch {
    return NextResponse.json(
      { iceServers: FALLBACK_ICE_SERVERS, degraded: "turn-unreachable" },
      { status: 502 },
    );
  }
}
