/**
 * Watches the microphone's own level, so a dropout can be located rather than
 * guessed at.
 *
 * The reported fault is that on high, loud notes the microphone "goes broke"
 * and comes back when the singing drops low and quiet again. Several very
 * different things produce that symptom, and they need opposite fixes:
 *
 *   - the browser's own processing gating a sustained note it reads as noise
 *   - the operating system's voice isolation doing the same, below the browser
 *   - the input clipping, and the processing then suppressing the mess
 *   - the encoder or the network dropping it, long after capture
 *
 * This module separates the last one from the first three, which is the split
 * that matters. The level here is measured from the raw MediaStream through
 * Web Audio, which sits BEFORE the encoder and after all capture processing.
 * So if the signal collapses in these numbers, the fault is in capture and no
 * amount of encoder or network work will touch it. If it does not collapse
 * here but the other person still hears nothing, the fault is downstream.
 *
 * One evening's numbers answer a question that no amount of reading the code
 * could settle.
 */

/**
 * Above this, someone is unambiguously singing rather than breathing near the
 * microphone. Matches the threshold the singing-turn detector already trusts
 * to hand the music over, so the two agree about what a voice is.
 */
export const LOUD_RMS = 0.06;

/**
 * Below this the microphone is delivering nothing at all. Not silence in the
 * musical sense -- a room tone, a breath, a held note decaying -- but a signal
 * that has actually stopped.
 */
export const GATE_FLOOR_RMS = 0.005;

/**
 * Above this the input is close enough to full scale that the converter is
 * probably clipping. Worth counting separately: clipping is a fault in front
 * of the microphone, fixed by singing further from it or turning the input
 * down, and no software setting will rescue a signal already squared off.
 */
export const CLIP_RMS = 0.7;

export interface LevelWatch {
  /** The loudest reading seen so far, 0 to 1. */
  peak: number;
  /** How many times a clear voice collapsed straight into silence. */
  gates: number;
  /** How many readings were loud enough to suspect a clipped input. */
  clips: number;
  /** The previous reading, which is what makes a collapse visible. */
  last: number;
}

export const EMPTY_WATCH: LevelWatch = { peak: 0, gates: 0, clips: 0, last: 0 };

/**
 * Folds one meter reading into the running picture.
 *
 * A dropout is deliberately defined as the transition rather than the state:
 * a voice that was unmistakably there one sample ago and is completely absent
 * now. Singing does not do that. It decays, and every natural decay passes
 * through the quiet middle on its way down, which is why the previous reading
 * has to have been loud for this to count at all.
 */
export function observeLevel(prev: LevelWatch, rms: number): LevelWatch {
  if (!Number.isFinite(rms) || rms < 0) return prev;

  const collapsed = prev.last >= LOUD_RMS && rms < GATE_FLOOR_RMS;
  return {
    peak: Math.max(prev.peak, rms),
    gates: prev.gates + (collapsed ? 1 : 0),
    clips: prev.clips + (rms >= CLIP_RMS ? 1 : 0),
    last: rms,
  };
}

const plural = (n: number, word: string): string =>
  `${n} ${word}${n === 1 ? "" : "s"}`;

/** The running picture as one line, for the pasteable report. */
export function describeLevel(watch: LevelWatch): string {
  if (watch.peak === 0) return "no signal yet";

  const parts = [`peak ${watch.peak.toFixed(2)}`];
  if (watch.gates > 0) parts.push(plural(watch.gates, "dropout"));
  if (watch.clips > 0) parts.push(`${watch.clips} clipped`);
  return parts.join(", ");
}
