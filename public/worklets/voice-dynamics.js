/**
 * Converts a duration into the per-sample coefficient for a one-pole follower.
 * A zero or malformed duration means an immediate move, which keeps a bad
 * setting from leaving the microphone stuck at an old gain.
 */
function onePoleCoefficient(milliseconds, samplesPerSecond) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return 0;

  return Math.exp(-1 / ((milliseconds / 1000) * samplesPerSecond));
}

function dbFromAmplitude(amplitude) {
  return 20 * Math.log10(Math.max(amplitude, 1e-6));
}

function gainFromDb(decibels) {
  return 10 ** (decibels / 20);
}

/**
 * Creates the level-only microphone stage independently of Web Audio. Keeping
 * this state here lets the worklet and its tests use precisely the same path.
 */
export function createVoiceDynamics(settings, samplesPerSecond) {
  const sampleRate =
    Number.isFinite(samplesPerSecond) && samplesPerSecond > 0
      ? samplesPerSecond
      : 48000;
  const gate = settings.gate;
  const compressor = settings.compressor;
  const makeupDb = Number.isFinite(settings.makeupDb) ? settings.makeupDb : 0;
  const ceilingDb = Number.isFinite(settings.ceilingDb)
    ? settings.ceilingDb
    : -1;
  const ceiling = gainFromDb(ceilingDb);

  const detectorAttack = onePoleCoefficient(1, sampleRate);
  const detectorRelease = onePoleCoefficient(60, sampleRate);
  const gateOpen =
    gate === null ? 0 : onePoleCoefficient(gate.attackMs, sampleRate);
  const gateClose =
    gate === null ? 0 : onePoleCoefficient(gate.releaseMs, sampleRate);
  const compressorAttack =
    compressor === null
      ? 0
      : onePoleCoefficient(compressor.attackMs, sampleRate);
  const compressorRelease =
    compressor === null
      ? 0
      : onePoleCoefficient(compressor.releaseMs, sampleRate);
  const limiterRecovery = onePoleCoefficient(50, sampleRate);
  const holdSamples =
    gate === null
      ? 0
      : Math.max(0, Math.round((gate.holdMs / 1000) * sampleRate));

  let detector = 0;
  let gateDb = 0;
  let reductionDb = 0;
  let limiterGain = 1;
  let holdCount = 0;
  let lastGainDb = makeupDb;

  return {
    get gainDb() {
      return lastGainDb;
    },

    processBlock(input, output) {
      for (let index = 0; index < input.length; index += 1) {
        const candidate = input[index];
        const sample = Number.isFinite(candidate) ? candidate : 0;
        const magnitude = Math.abs(sample);
        const detectorCoefficient =
          magnitude > detector ? detectorAttack : detectorRelease;
        detector += (magnitude - detector) * (1 - detectorCoefficient);
        const levelDb = dbFromAmplitude(detector);

        if (gate !== null) {
          let gateTargetDb = 0;
          if (levelDb >= gate.thresholdDb) {
            holdCount = 0;
          } else {
            holdCount = Math.min(holdCount + 1, holdSamples);
            if (holdCount >= holdSamples) gateTargetDb = -gate.rangeDb;
          }

          const gateCoefficient = gateTargetDb > gateDb ? gateOpen : gateClose;
          gateDb += (gateTargetDb - gateDb) * (1 - gateCoefficient);
        }

        if (compressor !== null) {
          const overDb = levelDb - compressor.thresholdDb;
          const targetReductionDb =
            overDb > 0 ? overDb * (1 - 1 / compressor.ratio) : 0;
          const reductionCoefficient =
            targetReductionDb > reductionDb
              ? compressorAttack
              : compressorRelease;
          reductionDb +=
            (targetReductionDb - reductionDb) * (1 - reductionCoefficient);
        }

        lastGainDb = gateDb - reductionDb + makeupDb;
        const shaped = sample * gainFromDb(lastGainDb);

        // The limiter is last because fixed makeup must never make an encoder
        // clip, even for a malformed or unexpectedly hot capture sample.
        if (Math.abs(shaped) * limiterGain > ceiling) {
          limiterGain = shaped === 0 ? 1 : ceiling / Math.abs(shaped);
        } else {
          limiterGain += (1 - limiterGain) * (1 - limiterRecovery);
        }

        // Hard clamping is a final safety net against rounding at the ceiling.
        const limited = shaped * limiterGain;
        output[index] = Number.isFinite(limited)
          ? Math.max(-ceiling, Math.min(ceiling, limited))
          : Math.sign(shaped) * ceiling;
      }
    },
  };
}

if (
  typeof registerProcessor === "function" &&
  typeof AudioWorkletProcessor === "function"
) {
  class VoiceDynamicsProcessor extends AudioWorkletProcessor {
    constructor(options) {
      super();
      this.dynamics = createVoiceDynamics(
        options.processorOptions.settings,
        sampleRate,
      );
    }

    process(inputs, outputs) {
      const outputChannels = outputs[0];
      const input = inputs[0] && inputs[0][0];
      const firstOutput = outputChannels[0];

      if (input === undefined) {
        for (const output of outputChannels) output.fill(0);
        return true;
      }

      this.dynamics.processBlock(input, firstOutput);
      for (let channel = 1; channel < outputChannels.length; channel += 1) {
        outputChannels[channel].set(firstOutput);
      }
      return true;
    }
  }

  registerProcessor("voice-dynamics", VoiceDynamicsProcessor);
}
