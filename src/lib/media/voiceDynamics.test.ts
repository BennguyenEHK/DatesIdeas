import { describe, expect, it } from "vitest";
import { createVoiceDynamics } from "../../../public/worklets/voice-dynamics.js";
import { VOICE_STYLES } from "./voiceStyles";

const SAMPLE_RATE = 48000;
const BLOCK_SIZE = 128;
const CEILING = 10 ** (-1 / 20);

function sine(
  amplitude: number,
  frequency: number,
  samples: number,
  start = 0,
): Float32Array {
  return Float32Array.from(
    { length: samples },
    (_, index) =>
      amplitude *
      Math.sin((2 * Math.PI * frequency * (start + index)) / SAMPLE_RATE),
  );
}

function process(
  settings: (typeof VOICE_STYLES)[keyof typeof VOICE_STYLES]["dynamics"],
  input: Float32Array,
) {
  const dynamics = createVoiceDynamics(settings, SAMPLE_RATE);
  const output = new Float32Array(input.length);
  const gains: number[] = [];

  for (let start = 0; start < input.length; start += BLOCK_SIZE) {
    dynamics.processBlock(
      input.subarray(start, start + BLOCK_SIZE),
      output.subarray(start, start + BLOCK_SIZE),
    );
    gains.push(dynamics.gainDb);
  }

  return { output, gains };
}

function rms(samples: Float32Array): number {
  return Math.sqrt(
    samples.reduce((sum, sample) => sum + sample ** 2, 0) / samples.length,
  );
}

function peak(samples: Float32Array): number {
  return samples.reduce(
    (maximum, sample) => Math.max(maximum, Math.abs(sample)),
    0,
  );
}

function dbRatio(numerator: number, denominator: number): number {
  return 20 * Math.log10(numerator / denominator);
}

describe("voice dynamics worklet", () => {
  it("does not lift open-speaker echo residual", () => {
    const input = sine(10 ** (-55 / 20), 300, SAMPLE_RATE * 2);
    const { output } = process(VOICE_STYLES["open-speakers"].dynamics, input);
    const window = SAMPLE_RATE / 2;

    // A closed gate (-20dB) and no makeup on speakers leaves the residual 20dB
    // quieter than it arrived. The old compressor lifted it by over 9dB.
    expect(
      dbRatio(rms(output.subarray(-window)), rms(input.subarray(-window))),
    ).toBeCloseTo(-20, 0);
  });

  it("does not lift quiet sound in clean mode", () => {
    const input = sine(10 ** (-55 / 20), 300, SAMPLE_RATE * 2);
    const { output } = process(VOICE_STYLES.clean.dynamics, input);
    const window = SAMPLE_RATE / 2;

    // -18dB gate with +8dB makeup: about 10dB below where it started.
    expect(
      dbRatio(rms(output.subarray(-window)), rms(input.subarray(-window))),
    ).toBeCloseTo(-10, 0);
  });

  it("keeps every style below the limiter ceiling", () => {
    for (const style of Object.values(VOICE_STYLES)) {
      for (const amplitude of [2, 10 ** (-3 / 20)]) {
        const { output } = process(
          style.dynamics,
          sine(amplitude, 1000, SAMPLE_RATE),
        );

        expect(peak(output)).toBeLessThanOrEqual(CEILING + 1e-6);
      }
    }
  });

  it("opens the speaker gate in time for a first syllable", () => {
    const silence = new Float32Array(SAMPLE_RATE);
    const note = sine(10 ** (-20 / 20), 440, SAMPLE_RATE, SAMPLE_RATE);
    const input = new Float32Array(silence.length + note.length);
    input.set(note, silence.length);
    const { output } = process(VOICE_STYLES["open-speakers"].dynamics, input);
    const onset = SAMPLE_RATE;
    const earlyPeak = peak(
      output.subarray(onset + SAMPLE_RATE * 0.005, onset + SAMPLE_RATE * 0.01),
    );
    const steadyPeak = peak(
      output.subarray(onset + SAMPLE_RATE * 0.5, onset + SAMPLE_RATE * 0.55),
    );

    expect(dbRatio(earlyPeak, steadyPeak)).toBeGreaterThanOrEqual(-3);
  });

  it("does not pump on a held clean note", () => {
    const { gains } = process(
      VOICE_STYLES.clean.dynamics,
      sine(10 ** (-18 / 20), 440, SAMPLE_RATE * 3),
    );
    const finalGains = gains.slice((SAMPLE_RATE * 0.5) / BLOCK_SIZE);

    expect(Math.max(...finalGains) - Math.min(...finalGains)).toBeLessThan(1);
  });

  it("gives a quiet headphone voice exactly its makeup gain", () => {
    const input = sine(10 ** (-30 / 20), 440, SAMPLE_RATE);
    const { output } = process(VOICE_STYLES.open.dynamics, input);
    const window = SAMPLE_RATE / 2;

    expect(
      dbRatio(rms(output.subarray(-window)), rms(input.subarray(-window))),
    ).toBeCloseTo(8, 1);
  });

  it("treats low and high clean notes with the same level gain", () => {
    const amplitude = 10 ** (-20 / 20);
    const lowInput = sine(amplitude, 300, SAMPLE_RATE);
    const highInput = sine(amplitude, 6000, SAMPLE_RATE);
    const low = process(VOICE_STYLES.clean.dynamics, lowInput).output;
    const high = process(VOICE_STYLES.clean.dynamics, highInput).output;
    const window = SAMPLE_RATE / 2;

    expect(
      Math.abs(
        dbRatio(rms(low.subarray(-window)), rms(lowInput.subarray(-window))) -
          dbRatio(
            rms(high.subarray(-window)),
            rms(highInput.subarray(-window)),
          ),
      ),
    ).toBeLessThan(0.5);
  });

  it("never lifts a loud input, so a feedback loop cannot climb to full scale", () => {
    // Two people on speakers form a loop through each other's rooms. A stage
    // that still adds gain at high level lets that loop grow until only the
    // limiter stops it: a constant, full-volume tone.
    for (const [name, style] of Object.entries(VOICE_STYLES)) {
      const input = sine(10 ** (-6 / 20), 1000, SAMPLE_RATE);
      const { output } = process(style.dynamics, input);
      const window = SAMPLE_RATE / 2;
      const gain = dbRatio(
        rms(output.subarray(-window)),
        rms(input.subarray(-window)),
      );

      expect(gain, name).toBeLessThanOrEqual(0);
    }
  });

  it("lets a two-device loop on speakers die away instead of building a tone", () => {
    // Each side: microphone = what its own speakers play, attenuated by a weak
    // echo canceller (-3dB, far worse than a working one), then the speaker
    // style's dynamics, then 250ms of network to the other side's speakers.
    // A short sung word on one side is the only thing ever put into the loop.
    for (const name of ["open-speakers", "clean-speakers"] as const) {
      const settings = VOICE_STYLES[name].dynamics;
      const here = createVoiceDynamics(settings, SAMPLE_RATE);
      const there = createVoiceDynamics(settings, SAMPLE_RATE);
      const coupling = 10 ** (-3 / 20);
      const delay = SAMPLE_RATE / 4;
      const total = SAMPLE_RATE * 8;
      const outHere = new Float32Array(total);
      const outThere = new Float32Array(total);
      const micHere = new Float32Array(BLOCK_SIZE);
      const micThere = new Float32Array(BLOCK_SIZE);

      for (let start = 0; start < total; start += BLOCK_SIZE) {
        for (let index = 0; index < BLOCK_SIZE; index += 1) {
          const n = start + index;
          const word =
            n < SAMPLE_RATE * 0.4
              ? 10 ** (-12 / 20) * Math.sin((2 * Math.PI * 440 * n) / SAMPLE_RATE)
              : 0;
          micHere[index] =
            word + (n >= delay ? coupling * outThere[n - delay] : 0);
          micThere[index] = n >= delay ? coupling * outHere[n - delay] : 0;
        }
        here.processBlock(micHere, outHere.subarray(start, start + BLOCK_SIZE));
        there.processBlock(
          micThere,
          outThere.subarray(start, start + BLOCK_SIZE),
        );
      }

      expect(peak(outHere.subarray(-SAMPLE_RATE)), name).toBeLessThan(
        10 ** (-40 / 20),
      );
    }
  });

  it("contains non-finite input samples", () => {
    const input = Float32Array.from([
      0.1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -0.1,
      0.1,
    ]);
    const output = new Float32Array(input.length);
    const dynamics = createVoiceDynamics(
      VOICE_STYLES.open.dynamics,
      SAMPLE_RATE,
    );
    dynamics.processBlock(input, output);

    expect(Array.from(output).every(Number.isFinite)).toBe(true);
    expect(Number.isFinite(output[3])).toBe(true);
    expect(Number.isFinite(output[4])).toBe(true);
  });

  it("can be imported when AudioWorklet globals are unavailable", () => {
    // The static import above ran in Vitest, where registerProcessor is absent.
    expect(createVoiceDynamics).toBeTypeOf("function");
  });
});
