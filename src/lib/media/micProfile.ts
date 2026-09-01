/**
 * Microphone settings for talking, and for singing.
 *
 * The browser's default audio processing is built for speech. Noise
 * suppression treats sustained music as noise and ducks it, and automatic gain
 * pumps the level up and down across a held note — so a singing voice arrives
 * thin and gated. Turning them off is what makes karaoke sound like a person
 * rather than a phone call.
 *
 * This is only safe in headphones. With speakers, echo cancellation is the one
 * thing stopping your microphone sending your partner a second copy of the
 * song they are already playing, a fraction of a second behind their own — the
 * flanging echo that ruins online karaoke. The app confirms headphones before
 * it applies this, and that confirmation is the whole reason it can.
 */
export const SPEECH_AUDIO: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

export const SINGING_AUDIO: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

/**
 * Retunes the live microphone without renegotiating the call.
 *
 * applyConstraints swaps the settings on the existing track, so the connection
 * is untouched and nothing drops. Failures are swallowed on purpose: not every
 * device honours every constraint, and a microphone that stays tuned for
 * speech is a worse-sounding karaoke, not a broken call.
 */
export async function tuneMicrophone(
  stream: MediaStream | null,
  singing: boolean,
): Promise<void> {
  if (!stream) return;
  const constraints = singing ? SINGING_AUDIO : SPEECH_AUDIO;
  await Promise.all(
    stream.getAudioTracks().map((track) =>
      track.applyConstraints(constraints).catch(() => {}),
    ),
  );
}
