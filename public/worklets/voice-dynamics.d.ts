// Types for importing the worklet module into tests. The settings shape lives
// in voiceStyles.ts so the two can never drift apart.
import type { VoiceDynamicsSettings } from "../../src/lib/media/voiceStyles";

export interface VoiceDynamics {
  /** The gate, compressor and makeup gain last applied, excluding the limiter. */
  readonly gainDb: number;
  processBlock(input: Float32Array, output: Float32Array): void;
}

export function createVoiceDynamics(
  settings: VoiceDynamicsSettings,
  sampleRate: number,
): VoiceDynamics;
