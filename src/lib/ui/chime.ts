/** The deliberately small slice of Web Audio that the whisper needs. */
export interface ChimeAudioParamLike {
  setValueAtTime(value: number, startTime: number): unknown;
  linearRampToValueAtTime(value: number, endTime: number): unknown;
  exponentialRampToValueAtTime(value: number, endTime: number): unknown;
}

export interface ChimeGainLike {
  gain: ChimeAudioParamLike;
  connect(destination: unknown): unknown;
}

export interface ChimeOscillatorLike {
  type: "sine" | "square" | "sawtooth" | "triangle" | string;
  frequency: Pick<ChimeAudioParamLike, "setValueAtTime">;
  connect(destination: unknown): unknown;
  start(when?: number): unknown;
  stop(when?: number): unknown;
}

export interface ChimeContextLike {
  currentTime: number;
  destination: unknown;
  createGain(): ChimeGainLike;
  createOscillator(): ChimeOscillatorLike;
}

const VOICES = {
  // A fifth makes each two-tone voice feel like a tiny sustained instrument,
  // rather than the sharp single note associated with notifications.
  sent: [392, 587.33],
  // The same shape shifted up: it is recognisably the same instrument, but
  // brighter enough to notice when it comes from the other seat.
  received: [523.25, 783.99],
} as const;

/**
 * Plays the small shared chime. Browsers can reject audio at any point until a
 * person has interacted with the page, so sound is always a best-effort extra
 * and never an error path for chat.
 */
export function playChime(ctx: ChimeContextLike, kind: "sent" | "received"): void {
  try {
    const startsAt = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, startsAt);
    gain.gain.linearRampToValueAtTime(0.06, startsAt + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, startsAt + 0.54);
    gain.connect(ctx.destination);

    for (const frequency of VOICES[kind]) {
      const oscillator = ctx.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, startsAt);
      oscillator.connect(gain);
      oscillator.start(startsAt);
      oscillator.stop(startsAt + 0.6);
    }
  } catch {
    // Chat is still complete when an autoplay policy or unsupported browser
    // declines this optional sound.
  }
}
