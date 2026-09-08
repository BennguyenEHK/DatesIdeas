import {
  readMicSettings,
  unmetRequests,
  type MicSettings,
} from "./micState";

/** The narrowest shape of an RTCRtpSender this module needs. */
export interface AudioSenderLike {
  track: { kind: string } | null;
  replaceTrack(track: MediaStreamTrack | null): Promise<void>;
}

/** Just the part of navigator.mediaDevices this needs, so it can be faked. */
export interface MicSource {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
}

export interface OpenedMic {
  track: MediaStreamTrack;
  /** Everything else the request returned, so the caller can stop it. */
  stream: MediaStream;
  settings: MicSettings | null;
  unmet: string[];
}

/**
 * Opens a new microphone with its processing profile decided at the device.
 *
 * Processing flags have to arrive with getUserMedia. A browser can resolve an
 * applyConstraints call on an existing track while retaining its speech
 * processing, whereas this new track is the first chance it has to settle on
 * the requested karaoke profile. A refusal remains a worse-sounding karaoke,
 * not a reason to break the call already carrying the old microphone.
 */
export async function openMic(
  source: MicSource,
  audio: MediaTrackConstraints,
): Promise<OpenedMic | null> {
  if (typeof source.getUserMedia !== "function") return null;

  let stream: MediaStream;
  try {
    stream = await source.getUserMedia({ audio });
  } catch {
    return null;
  }

  let tracks: MediaStreamTrack[];
  try {
    tracks = stream.getAudioTracks();
  } catch {
    return null;
  }
  const track = tracks[0];
  if (track === undefined) return null;

  const settings = readMicSettings(track);
  return { track, stream, settings, unmet: unmetRequests(audio, settings) };
}

/**
 * Replaces the sender's microphone without creating a new WebRTC negotiation.
 *
 * replaceTrack preserves the call's established audio path while moving it to
 * the fresh device track. A browser that refuses that replacement leaves the
 * old microphone in place, which is still better than dropping two people in
 * the middle of a song.
 */
export async function swapMicTrack(
  sender: AudioSenderLike,
  next: MediaStreamTrack,
): Promise<boolean> {
  if (sender.track === null || sender.track.kind !== "audio") return false;

  try {
    await sender.replaceTrack(next);
    return true;
  } catch {
    return false;
  }
}

/**
 * Releases every track the new microphone request opened.
 *
 * A stream can include more than the audio track selected for the sender, and
 * leaving any of them running can keep the physical device busy until reload.
 * Some browser shims cannot enumerate tracks at all; that is a cleanup gap,
 * not a reason for failure handling to throw over the live call.
 */
export function stopMic(opened: OpenedMic | null): void {
  if (opened === null) return;

  let tracks: MediaStreamTrack[];
  try {
    tracks = opened.stream.getTracks();
  } catch {
    return;
  }

  for (const track of tracks) {
    try {
      track.stop();
    } catch {
      // One stubborn track must not leave the rest holding the device open.
    }
  }
}
