/** The earliest valid position in a track. */
export const START_OF_TRACK_SEC = 0;

/** The rate that preserves one second of audio for each context-clock second. */
export const NORMAL_PLAYBACK_RATE = 1;

export interface ClockState {
  /** Position within the track, in seconds, true as of atContextTime. */
  positionSec: number;
  /** The AudioContext.currentTime value positionSec was true at. */
  atContextTime: number;
  /** Playback rate in force since atContextTime. 1 is normal speed. */
  rate: number;
  playing: boolean;
  /** Track length in seconds. Position is clamped to it. */
  durationSec: number;
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : START_OF_TRACK_SEC;
}

function durationOf(durationSec: number): number {
  return Math.max(START_OF_TRACK_SEC, finiteOrZero(durationSec));
}

function positionInTrack(positionSec: number, durationSec: number): number {
  return Math.min(durationSec, Math.max(START_OF_TRACK_SEC, finiteOrZero(positionSec)));
}

function validRate(rate: number, fallback: number): number {
  return Number.isFinite(rate) && rate > START_OF_TRACK_SEC ? rate : fallback;
}

function normalized(state: ClockState): ClockState {
  const durationSec = durationOf(state.durationSec);
  return {
    positionSec: positionInTrack(state.positionSec, durationSec),
    atContextTime: finiteOrZero(state.atContextTime),
    rate: validRate(state.rate, NORMAL_PLAYBACK_RATE),
    playing: state.playing,
    durationSec,
  };
}

/**
 * Starts a new local clock from the offset given to AudioBufferSourceNode.start.
 *
 * Keeping the offset and context instant together means later position reads do
 * not depend on a source node exposing state that Web Audio deliberately lacks.
 */
export function startedAt(
  durationSec: number,
  atContextTime: number,
  offsetSec: number,
  rate: number = NORMAL_PLAYBACK_RATE,
): ClockState {
  const safeDurationSec = durationOf(durationSec);
  return {
    positionSec: positionInTrack(offsetSec, safeDurationSec),
    atContextTime: finiteOrZero(atContextTime),
    rate: validRate(rate, NORMAL_PLAYBACK_RATE),
    playing: true,
    durationSec: safeDurationSec,
  };
}

/**
 * Finds the track position described by a context-clock reading.
 *
 * Context time must not pull the playhead backward: a stalled or stale clock
 * reading is safer to treat as no elapsed playback than as a rewind.
 */
export function positionAt(state: ClockState, contextTime: number): number {
  const safeState = normalized(state);
  if (!safeState.playing) return safeState.positionSec;

  const elapsedSec = Math.max(
    START_OF_TRACK_SEC,
    finiteOrZero(contextTime) - safeState.atContextTime,
  );
  return positionInTrack(
    safeState.positionSec + elapsedSec * safeState.rate,
    safeState.durationSec,
  );
}

function rebasedAt(state: ClockState, contextTime: number): ClockState {
  const safeState = normalized(state);
  const atContextTime = finiteOrZero(contextTime);
  return {
    ...safeState,
    positionSec: positionAt(safeState, atContextTime),
    atContextTime,
  };
}

export function withRate(state: ClockState, contextTime: number, rate: number): ClockState {
  const rebased = rebasedAt(state, contextTime);
  return { ...rebased, rate: validRate(rate, rebased.rate) };
}

export function pausedAt(state: ClockState, contextTime: number): ClockState {
  return { ...rebasedAt(state, contextTime), playing: false };
}

export function resumedAt(state: ClockState, contextTime: number): ClockState {
  return { ...rebasedAt(state, contextTime), playing: true };
}

export function seekedTo(
  state: ClockState,
  contextTime: number,
  positionSec: number,
): ClockState {
  const rebased = rebasedAt(state, contextTime);
  return {
    ...rebased,
    positionSec: positionInTrack(positionSec, rebased.durationSec),
  };
}
