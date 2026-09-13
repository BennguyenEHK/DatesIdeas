/** Five seconds at the microphone meter's 100ms sampling rate. */
export const ROOM_WINDOW_SAMPLES = 50;
/** A loud tail at least this high means somebody spoke or sang. */
export const VOICE_RMS = 0.03;
/** Below this the microphone is muted or delivering no usable signal. */
export const SILENT_RMS = 0.002;
/** Voice this close to the room is not clear enough for quiet mode. */
export const NOISY_SNR_DB = 18;
/** Voice this far above the room is clear enough for quiet mode. */
export const QUIET_SNR_DB = 24;
/**
 * A room this loud is noisy even when nobody has clearly spoken.
 *
 * Deliberately high. The meter reads the singing microphone AFTER its boost,
 * which lifts quiet sound by roughly 9dB on speakers and 15dB in headphones,
 * so an ordinary silent room can already read near 0.01 there. Only a
 * background that stays loud after that lift counts on its own; anything
 * subtler waits for a voice to compare against.
 */
export const LOUD_FLOOR_RMS = 0.03;

export type RoomVerdict = "noisy" | "quiet" | "unsure";

export interface RoomReading {
  floorRms: number;
  voiceRms: number;
  snrDb: number | null;
  verdict: RoomVerdict;
}

/** Returns the nearest-rank percentile without disturbing the meter's buffer. */
function percentile(sorted: readonly number[], percent: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.ceil((percent / 100) * sorted.length) - 1] ?? 0;
}

/**
 * Judges one continuous, unprocessed microphone window.
 *
 * Breaths and phrase gaps occupy the low readings, so their percentile is the
 * room. The loud tail is where a voice appears. Their ratio travels far better
 * between microphones than either absolute level, whose gain varies by device.
 */
export function judgeRoom(samples: readonly number[]): RoomReading {
  const sorted = samples
    .filter((sample) => Number.isFinite(sample) && sample >= 0)
    .sort((a, b) => a - b);
  const floorRms = percentile(sorted, 20);
  const voiceRms = percentile(sorted, 90);

  if (sorted.length < ROOM_WINDOW_SAMPLES) {
    return { floorRms, voiceRms, snrDb: null, verdict: "unsure" };
  }

  if (voiceRms < SILENT_RMS) {
    return { floorRms, voiceRms, snrDb: null, verdict: "unsure" };
  }

  const snrDb = 20 * Math.log10(voiceRms / Math.max(floorRms, 1e-4));

  if (voiceRms >= VOICE_RMS) {
    if (snrDb < NOISY_SNR_DB) {
      return { floorRms, voiceRms, snrDb, verdict: "noisy" };
    }
    if (snrDb >= QUIET_SNR_DB) {
      return { floorRms, voiceRms, snrDb, verdict: "quiet" };
    }
    return { floorRms, voiceRms, snrDb, verdict: "unsure" };
  }

  return {
    floorRms,
    voiceRms,
    snrDb,
    verdict: floorRms >= LOUD_FLOOR_RMS ? "noisy" : "unsure",
  };
}
