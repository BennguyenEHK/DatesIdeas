/**
 * Asks Opus for a singing voice instead of a speaking one.
 *
 * WebRTC negotiates audio for a phone call by default: around 32kbps, with
 * discontinuous transmission that clips the start of quiet sounds. Both are
 * right for talking and wrong for singing — they are exactly the thin,
 * band-limited voice people describe as "filtered".
 *
 * What it does NOT need is a second channel. The fix for "filtered" is the
 * bitrate and the transmission settings below; stereo was included with them
 * once and turned out to be the expensive half of a change whose cheap half did
 * all the work.
 *
 * Rewriting the offer is the only place these can be set; there is no API for
 * it. The parameters are merged into whatever the browser already proposed
 * rather than replacing the line, so nothing else it negotiated is lost.
 */
const MUSIC_PARAMS: Record<string, string> = {
  // Mono, and asked for explicitly rather than by omission.
  //
  // This used to ask for stereo, on the reasoning that music deserves two
  // channels. It does -- but the thing being encoded here is never music. It is
  // one person singing into one microphone capsule, and a capsule has nothing to
  // put in a second channel. The device reports two because the capture request
  // asks for two, so the encoder was being handed a duplicate and charged for
  // carrying it.
  //
  // A real evening's telemetry says what that cost: audio ran at 128 kbps in
  // both directions while the uplink headroom fell to 752 kbps and video was
  // already taking 500. Nothing was lost -- 0.0% -- but the jitter buffer
  // ballooned past a second, which is what a queue does before it starts
  // dropping. Half of that audio was a copy of the other half.
  stereo: "0",
  "sprop-stereo": "0",
  // Twice the ~32kbps WebRTC negotiates for a phone call, which is what made
  // the voice sound thin and band-limited, and half what was being spent on
  // carrying it in duplicate. Mono Opus is transparent for a solo voice here,
  // so this buys back real headroom on a link measured at 84% utilisation
  // without giving up anything anybody can hear.
  maxaveragebitrate: "64000",
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
