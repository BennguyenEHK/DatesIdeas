/** Just the part of Web Audio this needs, so it can be faked in jsdom. */
export interface AudioContextLike {
  createMediaStreamSource(stream: MediaStream): AudioNodeLike;
  createDynamicsCompressor(): CompressorLike;
  createGain(): GainLike;
  createMediaStreamDestination(): { stream: MediaStream };
  close(): Promise<void>;
  /**
   * "suspended" until something wakes it, on browsers that autoplay-gate audio.
   *
   * This matters far more here than it would for a meter. A suspended graph
   * still hands back a perfectly valid destination track -- it simply carries
   * silence -- and that track is about to be put on the call in place of a
   * working microphone. Sending silence would be a much worse failure than the
   * quiet voice this whole stage exists to fix, so the state is checked rather
   * than assumed.
   */
  state?: string;
  resume?(): Promise<void>;
}

export interface AudioNodeLike {
  connect(destination: object): unknown;
}

export interface ParamLike {
  value: number;
}

export interface GainLike extends AudioNodeLike {
  gain: ParamLike;
}

export interface CompressorLike extends AudioNodeLike {
  threshold: ParamLike;
  knee: ParamLike;
  ratio: ParamLike;
  attack: ParamLike;
  release: ParamLike;
}

export interface BoostedMic {
  /** The processed track to send in place of the raw one. */
  track: MediaStreamTrack;
  /** Releases the graph. Never stops the source track, which is not ours. */
  close(): void;
}

/** This starts reducing level before a voice nears clipping, leaving room for the makeup gain to lift quiet singing. */
export const COMPRESSOR_THRESHOLD_DB = -30;

/** A wide knee lets compression arrive gradually instead of making a sung phrase cross an audible boundary. */
export const COMPRESSOR_KNEE_DB = 24;

/** This gentle ratio supports the voice without turning the stage into a limiter. */
export const COMPRESSOR_RATIO = 2.5;

/** This attack is slow enough to let a consonant through before the compressor smooths the following vowel. */
export const COMPRESSOR_ATTACK_S = 0.02;

/**
 * This 350ms release is longer than any vibrato cycle, so a sustained note
 * passes through at one steady gain instead of swelling and breathing as a
 * fast-release automatic gain control recovers within the held note.
 */
export const COMPRESSOR_RELEASE_S = 0.35;

/**
 * This 10dB makeup gain takes the observed 0.10 peak to roughly 0.32, safely
 * above the 0.06 singing threshold while remaining below both the old 0.50
 * automatic-gain peak and input level's 0.7 clipping warning.
 *
 * Correct only when nothing but the singer reaches the microphone. See
 * ECHO_SAFE_MAKEUP_GAIN_DB for why that condition is not always true.
 */
export const MAKEUP_GAIN_DB = 10;

/**
 * The makeup gain to use when the microphone is also hearing a loudspeaker.
 *
 * Singing on speakers means the song, and the other person's voice, come back
 * into the microphone. Echo cancellation subtracts most of that and leaves a
 * quiet residual, which is the best any canceller does.
 *
 * A compressor is an unusually bad thing to put in front of that residual.
 * Everything below COMPRESSOR_THRESHOLD_DB passes uncompressed and receives
 * the makeup gain in full, while everything above it is compressed and
 * receives less -- so a quiet echo is lifted HARDER than the loud voice the
 * stage was built for. Ten decibels of that is the difference between an echo
 * nobody notices and one the other person cannot sing over.
 *
 * Four decibels still restores some of what switching automatic gain control
 * off cost, without turning the residual into the loudest thing on the call.
 * The real cure is headphones, which removes the loop instead of quieting it.
 */
export const ECHO_SAFE_MAKEUP_GAIN_DB = 4;

/** Converts a decibel setting to the linear multiplier Web Audio gain parameters require. */
export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

interface DisconnectableNode {
  disconnect(): unknown;
}

function disconnect(node: AudioNodeLike | undefined): void {
  if (node === undefined) return;
  if (!("disconnect" in node)) return;

  const candidate = node as AudioNodeLike & Partial<DisconnectableNode>;
  if (typeof candidate.disconnect !== "function") return;

  try {
    candidate.disconnect();
  } catch {
    // A browser may already have released a node after the context closes.
  }
}

function closeContext(context: AudioContextLike): void {
  try {
    void context.close().catch(() => {
      // A rejected close means the graph is already gone, which is the desired end state.
    });
  } catch {
    // A nonconforming browser must not turn cleanup into a call failure.
  }
}

/**
 * Adds slow compression and fixed makeup gain to a karaoke microphone.
 *
 * The gain is a parameter rather than a constant because how much is safe
 * depends on what else the microphone can hear. A singer in headphones can
 * take the full lift; a singer on speakers is also holding a live microphone
 * in front of a loudspeaker playing the other person, and lifting that as hard
 * sends them back their own voice. ECHO_SAFE_MAKEUP_GAIN_DB is that case.
 *
 * A browser without this audio path keeps the raw microphone. That leaves a
 * quieter karaoke, but never replaces a working call with silence.
 */
export function boostMic(
  track: MediaStreamTrack,
  makeContext?: (() => AudioContextLike) | null,
  makeupDb: number = MAKEUP_GAIN_DB,
): BoostedMic | null {
  if (makeContext === null) return null;

  let context: AudioContextLike;
  try {
    if (makeContext !== undefined) {
      context = makeContext();
    } else {
      const ContextConstructor = globalThis.AudioContext;
      if (typeof ContextConstructor !== "function") return null;
      context = new ContextConstructor();
    }
  } catch {
    return null;
  }

  let source: AudioNodeLike | undefined;
  let compressor: CompressorLike | undefined;
  let gain: GainLike | undefined;
  try {
    const stream = new MediaStream([track]);
    source = context.createMediaStreamSource(stream);
    compressor = context.createDynamicsCompressor();
    gain = context.createGain();
    const destination = context.createMediaStreamDestination();

    compressor.threshold.value = COMPRESSOR_THRESHOLD_DB;
    compressor.knee.value = COMPRESSOR_KNEE_DB;
    compressor.ratio.value = COMPRESSOR_RATIO;
    compressor.attack.value = COMPRESSOR_ATTACK_S;
    compressor.release.value = COMPRESSOR_RELEASE_S;
    gain.gain.value = dbToGain(makeupDb);

    source.connect(compressor);
    compressor.connect(gain);
    gain.connect(destination);

    const processedTrack = destination.stream.getAudioTracks()[0];
    if (processedTrack === undefined) {
      disconnect(source);
      disconnect(compressor);
      disconnect(gain);
      closeContext(context);
      return null;
    }

    // Best effort, and deliberately not awaited: boostMic is synchronous by
    // contract, and by the time anyone is singing the page has had several
    // clicks. A browser that refuses is no worse off than one without resume
    // at all, and the caller keeps a raw microphone it can fall back to.
    if (context.state === "suspended" && typeof context.resume === "function") {
      try {
        void context.resume().catch(() => {
          // Nothing further to try; the raw microphone remains the fallback.
        });
      } catch {
        // A nonconforming browser must not turn a nicety into a failed call.
      }
    }

    let closed = false;
    return {
      track: processedTrack,
      close() {
        if (closed) return;
        closed = true;
        disconnect(source);
        disconnect(compressor);
        disconnect(gain);
        closeContext(context);
      },
    };
  } catch {
    if (source !== undefined) disconnect(source);
    if (compressor !== undefined) disconnect(compressor);
    if (gain !== undefined) disconnect(gain);
    closeContext(context);
    return null;
  }
}
