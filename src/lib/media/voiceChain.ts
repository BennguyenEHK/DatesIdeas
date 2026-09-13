import {
  VOICE_PROCESSOR_NAME,
  VOICE_STYLES,
  VOICE_WORKLET_URL,
  type VoiceStyle,
} from "./voiceStyles";

/** Just the Web Audio surface this graph needs, so jsdom can fake it. */
export interface AudioNodeLike {
  connect(destination: object): unknown;
  disconnect?(): unknown;
}

export interface BiquadFilterLike extends AudioNodeLike {
  type: BiquadFilterType;
  frequency: { value: number };
  Q: { value: number };
  gain: { value: number };
}

export interface VoiceContextLike {
  createMediaStreamSource(stream: MediaStream): AudioNodeLike;
  createBiquadFilter(): BiquadFilterLike;
  createMediaStreamDestination(): { stream: MediaStream };
  audioWorklet?: { addModule(url: string): Promise<void> };
  state?: string;
  resume?(): Promise<void>;
  close(): Promise<void>;
}

export interface VoiceChain {
  track: MediaStreamTrack;
  style: VoiceStyle;
  dynamics: boolean;
  /** Releases graph resources. It never stops the caller's captured track. */
  close(): void;
}

type WorkletFactory = (
  context: VoiceContextLike,
  name: string,
  options: AudioWorkletNodeOptions,
) => AudioNodeLike;

export interface VoiceChainDeps {
  makeContext?: (() => VoiceContextLike) | null;
  makeWorkletNode?: WorkletFactory;
}

function disconnect(node: AudioNodeLike | undefined): void {
  try {
    node?.disconnect?.();
  } catch {
    /* Context teardown can release nodes first. */
  }
}

function closeContext(context: VoiceContextLike): void {
  try {
    void context.close().catch(() => {});
  } catch {
    /* Cleanup stays best effort. */
  }
}

function defaultContext(): VoiceContextLike | null {
  const Constructor = globalThis.AudioContext;
  if (typeof Constructor !== "function") return null;
  // No sampleRate is forced. Firefox refuses to connect a microphone to a
  // context running at a different rate than the capture, and that refusal
  // would silently drop the whole chain; the capture already asks for 48kHz.
  try {
    return new Constructor({ latencyHint: "interactive" });
  } catch {
    try {
      return new Constructor();
    } catch {
      return null;
    }
  }
}

function defaultWorkletNode(
  context: VoiceContextLike,
  name: string,
  options: AudioWorkletNodeOptions,
): AudioNodeLike {
  return new AudioWorkletNode(
    context as unknown as BaseAudioContext,
    name,
    options,
  );
}

/**
 * Builds the karaoke path after capture processing has been disabled. The
 * browser suppressor is absent because it mistakes held notes for noise and
 * removes their highs. A fallback may retain filters, never un-limited makeup.
 */
export async function buildVoiceChain(
  track: MediaStreamTrack,
  style: VoiceStyle,
  deps: VoiceChainDeps = {},
): Promise<VoiceChain | null> {
  if (deps.makeContext === null) return null;
  let context: VoiceContextLike | null = null;
  let source: AudioNodeLike | undefined;
  let highpass: BiquadFilterLike | undefined;
  let presence: BiquadFilterLike | undefined;
  let worklet: AudioNodeLike | undefined;
  try {
    context =
      deps.makeContext === undefined ? defaultContext() : deps.makeContext();
    if (context === null) return null;
    const definition = VOICE_STYLES[style];
    source = context.createMediaStreamSource(new MediaStream([track]));
    let tail: AudioNodeLike = source;
    if (definition.highpassHz !== null) {
      highpass = context.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = definition.highpassHz;
      highpass.Q.value = 0.7071;
      tail.connect(highpass);
      tail = highpass;
    }
    if (definition.presence !== null) {
      presence = context.createBiquadFilter();
      presence.type = "peaking";
      presence.frequency.value = definition.presence.frequencyHz;
      presence.Q.value = definition.presence.q;
      presence.gain.value = definition.presence.gainDb;
      tail.connect(presence);
      tail = presence;
    }
    let dynamics = false;
    if (context.audioWorklet !== undefined) {
      try {
        await context.audioWorklet.addModule(VOICE_WORKLET_URL);
        worklet = (deps.makeWorkletNode ?? defaultWorkletNode)(
          context,
          VOICE_PROCESSOR_NAME,
          {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [1],
            processorOptions: { settings: definition.dynamics },
          },
        );
        tail.connect(worklet);
        tail = worklet;
        dynamics = true;
      } catch {
        disconnect(worklet);
        worklet = undefined;
      }
    }
    if (!dynamics && highpass === undefined && presence === undefined) {
      closeContext(context);
      return null;
    }
    const destination = context.createMediaStreamDestination();
    tail.connect(destination);
    const processedTrack = destination.stream.getAudioTracks()[0];
    if (processedTrack === undefined)
      throw new Error("No processed audio track");
    if (context.state === "suspended" && typeof context.resume === "function") {
      try {
        void context.resume().catch(() => {});
      } catch {
        /* Resume is best effort. */
      }
    }
    let closed = false;
    return {
      track: processedTrack,
      style,
      dynamics,
      close() {
        if (closed) return;
        closed = true;
        disconnect(source);
        disconnect(highpass);
        disconnect(presence);
        disconnect(worklet);
        closeContext(context as VoiceContextLike);
      },
    };
  } catch {
    disconnect(source);
    disconnect(highpass);
    disconnect(presence);
    disconnect(worklet);
    if (context !== null) closeContext(context);
    return null;
  }
}
