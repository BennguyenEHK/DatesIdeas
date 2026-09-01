/**
 * Asks Opus for music instead of speech.
 *
 * WebRTC negotiates audio for a phone call by default: mono, around 32kbps,
 * with discontinuous transmission that clips the start of quiet sounds. Every
 * one of those choices is right for talking and wrong for singing — it is
 * exactly the thin, band-limited voice people describe as "filtered".
 *
 * Rewriting the offer is the only place these can be set; there is no API for
 * it. The parameters are merged into whatever the browser already proposed
 * rather than replacing the line, so nothing else it negotiated is lost.
 */
const MUSIC_PARAMS: Record<string, string> = {
  stereo: "1",
  "sprop-stereo": "1",
  maxaveragebitrate: "128000",
  // Forward error correction: a lost packet is filled in rather than dropped,
  // which matters far more for a held note than for a syllable.
  useinbandfec: "1",
  // Discontinuous transmission stops sending during perceived silence. On a
  // voice call that saves bandwidth; on a quiet passage it gates the singing.
  usedtx: "0",
};

/** The payload type Opus was assigned in this SDP, if it was offered at all. */
function opusPayloadType(sdp: string): string | null {
  const match = /^a=rtpmap:(\d+)\s+opus\/48000(?:\/2)?/im.exec(sdp);
  return match ? match[1] : null;
}

function mergeParams(existing: string): string {
  const params = new Map<string, string>();
  for (const pair of existing.split(";")) {
    const trimmed = pair.trim();
    if (trimmed === "") continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) params.set(trimmed, "");
    else params.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
  }
  // Ours win: the browser's defaults are the thing being corrected.
  for (const [k, v] of Object.entries(MUSIC_PARAMS)) params.set(k, v);
  return [...params]
    .map(([k, v]) => (v === "" ? k : `${k}=${v}`))
    .join(";");
}

export function preferMusicAudio(sdp: string): string {
  const pt = opusPayloadType(sdp);
  if (pt === null) return sdp;

  const fmtp = new RegExp(`^a=fmtp:${pt} (.*)$`, "m");
  const found = fmtp.exec(sdp);

  if (found) return sdp.replace(fmtp, `a=fmtp:${pt} ${mergeParams(found[1])}`);

  // Opus was offered with no parameter line of its own; add one directly after
  // its rtpmap, keeping the line ending the rest of the SDP uses.
  const rtpmap = new RegExp(`^(a=rtpmap:${pt} opus/48000(?:/2)?.*)$`, "m");
  const eol = sdp.includes("\r\n") ? "\r\n" : "\n";
  return sdp.replace(rtpmap, `$1${eol}a=fmtp:${pt} ${mergeParams("")}`);
}
