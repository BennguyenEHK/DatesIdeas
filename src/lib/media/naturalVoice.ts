/**
 * The "Natural voice" switch for karaoke: the call's one microphone reopened
 * with the noise suppressor off, and the echo canceller and automatic gain
 * kept on.
 *
 * The noise suppressor fades a held note as if it were a fan, which is what
 * made high notes vanish. Automatic gain only squeezes a voice a little, and
 * with no boost stage it is the one thing keeping a singer who steps back
 * from the laptop audible -- a slightly compressed voice you can hear beats a
 * natural one you cannot. These are only on or off, and only chosen when the
 * device is OPENED, so the switch reopens the microphone. It is the same microphone, never a second copy
 * beside the first: a second copy on these laptops came back with its echo
 * canceller refused, and without one the speakers go straight back to the
 * other person as an echo loop.
 */

/**
 * Echo cancellation stays on and is never negotiable here. A device that will
 * not keep it in this mode does not get this mode at all.
 */
export const NATURAL_VOICE_AUDIO: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: false,
  autoGainControl: true,
};

export type MicMode = "call" | "natural";

/**
 * How the switch went: `ok` when the asked-for microphone is live, `refused`
 * when the device dropped the echo canceller and the call's microphone was
 * put back, `failed` when the natural microphone would not open at all.
 */
export type MicOutcome = "ok" | "refused" | "failed";

export interface ReopenResult {
  /** The microphone now open, or null when not even the call's would open. */
  track: MediaStreamTrack | null;
  mode: MicMode;
  outcome: MicOutcome;
}

/** Just the part of navigator.mediaDevices this needs, so it can be faked. */
export interface MicOpener {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
}

/** Just the part of RTCRtpSender this needs. */
export interface MicSender {
  replaceTrack(track: MediaStreamTrack | null): Promise<void>;
}

async function open(
  source: MicOpener,
  audio: MediaTrackConstraints,
): Promise<MediaStreamTrack | null> {
  try {
    const stream = await source.getUserMedia({ audio });
    return stream.getAudioTracks()[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Opens the microphone for a mode, and reads back whether the device honoured
 * the echo canceller before trusting it.
 *
 * The caller must have stopped the previous microphone first. One capture at
 * a time is the point: two at once is how the canceller got refused.
 *
 * Any failure on the way to natural ends on the call's own microphone, never
 * on silence, because a worse-sounding voice beats no voice.
 */
export async function reopenMic(
  source: MicOpener,
  mode: MicMode,
  callAudio: MediaTrackConstraints,
): Promise<ReopenResult> {
  if (mode === "call") {
    const track = await open(source, callAudio);
    return { track, mode: "call", outcome: track === null ? "failed" : "ok" };
  }

  const natural = await open(source, NATURAL_VOICE_AUDIO);
  if (natural !== null) {
    // `false` is a refusal. A browser that does not report the flag at all
    // is given the benefit of the doubt: it was asked, and silence is not no.
    if (natural.getSettings().echoCancellation !== false) {
      return { track: natural, mode: "natural", outcome: "ok" };
    }
    natural.stop();
  }

  const call = await open(source, callAudio);
  return { track: call, mode: "call", outcome: natural === null ? "failed" : "refused" };
}

/**
 * Puts a newly opened microphone where the call reads it: in the call's own
 * stream, in place of the old audio track, and on the sender.
 *
 * The stream object is kept rather than replaced, because the connection is
 * built from it and a new one would rebuild the call. replaceTrack changes
 * what is sent without renegotiating, so nothing drops.
 *
 * `enabled` is the mute switch: a freshly opened track always arrives
 * enabled, and a muted person must stay muted through the swap.
 */
export async function swapStreamMic(
  stream: MediaStream,
  sender: MicSender | null,
  next: MediaStreamTrack,
  enabled: boolean,
): Promise<void> {
  next.enabled = enabled;
  for (const old of stream.getAudioTracks()) stream.removeTrack(old);
  stream.addTrack(next);
  await sender?.replaceTrack(next);
}
