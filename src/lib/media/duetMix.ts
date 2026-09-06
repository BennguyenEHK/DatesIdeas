/**
 * How three sources merge into a stereo mix that listeners can follow.
 *
 * Two singers occupy the left and right channels so their voices do not mask
 * each other. Which side gets which is decided by role, not by which machine:
 * both machines independently agree on the same stereo picture, anchor on left,
 * so the remix stays consistent if one side hears faster than the other and
 * the roles swap. The music steps back when anyone is singing so voices shine
 * through without needing to shout.
 */

/** How far apart to place the two voices, as a stereo pan from -1 to 1. */
export const VOICE_SPREAD = 0.35;

/** How far the music steps back while anyone is singing, in decibels. */
export const MUSIC_DUCK_DB = -4;

export interface MixPlan {
  /** Pan for the local singer's own monitored voice, -1 (left) to 1 (right). */
  minePan: number;
  /** Pan for the incoming remote voice. */
  theirsPan: number;
  /** Music gain 0-1, already converted from decibels. */
  musicGain: number;
}

/**
 * Decibels to a linear gain multiplier.
 *
 * The formula is 10 raised to the power of (db / 20). Non-finite inputs return
 * 1 (unity gain) rather than NaN, because a NaN gain silences the entire mix
 * when applied to an audio node, which is worse than not ducking.
 */
export function gainFromDb(db: number): number {
  if (!Number.isFinite(db)) return 1;
  return Math.pow(10, db / 20);
}

/**
 * The stereo mix plan: where each voice sits and how loud the music is.
 *
 * Both machines independently apply the same plan, which is what makes the
 * stereo picture stable. The anchor's voice always goes left, the follower's
 * always goes right, regardless of which machine is which. If you are the
 * anchor, your monitored voice goes left and theirs goes right. If you are
 * the follower, yours goes right and theirs goes left, so the picture is
 * mirrored — but both versions have the anchor on the left and follower on
 * the right.
 */
export function mixPlan(
  anyoneSinging: boolean,
  iAmAnchor: boolean,
): MixPlan {
  return {
    // Decided by role alone, and deliberately NOT by whether anyone is
    // currently singing. Where a voice sits is a fact about the person, not
    // about the moment: the singing flags come from voice-activity detection,
    // which flickers several times inside a single phrase, so a pan that
    // followed them would slide each voice back and forth across the stereo
    // field on every syllable. Ducking can follow that flicker because a few
    // decibels of level is a texture; a moving position is a distraction.
    minePan: iAmAnchor ? -VOICE_SPREAD : VOICE_SPREAD,
    theirsPan: iAmAnchor ? VOICE_SPREAD : -VOICE_SPREAD,
    musicGain: anyoneSinging ? gainFromDb(MUSIC_DUCK_DB) : 1,
  };
}
