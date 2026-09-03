import type { PlayerHandle } from "@/lib/media/player";
import {
  pausedAt,
  positionAt,
  resumedAt,
  seekedTo,
  startedAt,
  withRate,
  type ClockState,
} from "./audioClock";

/**
 * The narrowest slices of Web Audio this player needs.
 *
 * Narrow on purpose, the way the recorder's support check is: the whole point
 * of this module is that it can be driven by a test with no browser in the
 * room, and a dependency on the real AudioContext would put a browser in the
 * room. The test file proves a real AudioContext still satisfies these.
 */
export interface ParamLike {
  value: number;
}

export interface GainLike {
  gain: ParamLike;
  connect(destination: never): void;
  disconnect(): void;
}

export interface SourceLike {
  buffer: AudioBuffer | null;
  playbackRate: ParamLike;
  /**
   * Takes the event, even though nothing here reads it.
   *
   * A real AudioBufferSourceNode's handler is called WITH an Event, and a
   * zero-argument type is not assignable from a one-argument one — so writing
   * the convenient `() => void` here would have made this whole interface
   * un-assignable from the browser object it exists to describe.
   */
  onended: ((event: Event) => void) | null;
  connect(destination: never): void;
  disconnect(): void;
  start(when?: number, offset?: number): void;
  stop(when?: number): void;
}

export interface ContextLike {
  currentTime: number;
  destination: unknown;
  createGain(): GainLike;
  createBufferSource(): SourceLike;
  resume(): Promise<void>;
}

export interface AudioPlayer extends PlayerHandle {
  /** Hands the player decoded audio, or takes it away. Stops any playback. */
  setTrack(buffer: AudioBuffer | null): void;
  /** Length of the loaded track, or 0 when there is none. */
  durationSec(): number;
  /** Releases the audio graph. Safe to call twice. */
  dispose(): void;
}

/**
 * A karaoke player that can actually change speed.
 *
 * This exists because of one line in PlayerHandle: setRate returns false on
 * YouTube, always, because its API rounds any rate it does not support back
 * towards 1. Every piece of smooth drift correction in this codebase --
 * rampPlan, RAMP_RATE, MAX_RAMP_SEC -- was written against that method and has
 * therefore never once run. Give the sync layer a player that returns true and
 * all of it switches on: two people four thousand kilometres apart converge at
 * 1.03x over a few seconds instead of jumping, and neither of them hears it.
 *
 * The other half of the win is that a seek here costs nothing. The samples are
 * already decoded and in memory, so there is no buffer to empty and no server
 * to ask -- which is why nudge and seek are the same operation below, where on
 * YouTube they had to be carefully different things.
 */
export function createAudioPlayer(context: ContextLike): AudioPlayer {
  const gain = context.createGain();
  // The cast is the one place the narrow interfaces meet the real graph. Web
  // Audio's connect is typed against AudioNode, which these deliberately are
  // not; keeping it here means the rest of the module stays free of it.
  gain.connect(context.destination as never);

  let track: AudioBuffer | null = null;
  let source: SourceLike | null = null;
  let volume = 100;
  let clock: ClockState = pausedAt(
    startedAt(0, context.currentTime, 0),
    context.currentTime,
  );

  function stopSource(): void {
    const current = source;
    source = null;
    if (current === null) return;
    // Cleared before stopping, because stop() fires onended and the handler
    // would otherwise pause a clock that a seek is in the middle of restarting.
    current.onended = null;
    try {
      current.stop();
    } catch {
      // A node that never started, or already ended, refuses to stop. Neither
      // is a problem: it is going away either way.
    }
    try {
      current.disconnect();
    } catch {
      // Same. The graph is being torn down regardless.
    }
  }

  /**
   * Every start needs a NEW node.
   *
   * An AudioBufferSourceNode is single-use: once started it can never be
   * started again, so playing, seeking and resuming all mean building a fresh
   * one. It is a cheap object and the buffer behind it is shared, so this
   * costs almost nothing -- but forgetting it produces a player that plays
   * exactly once and is then silently mute forever.
   */
  function startSource(fromSec: number, rate: number): void {
    if (track === null) return;
    stopSource();

    const next = context.createBufferSource();
    next.buffer = track;
    next.playbackRate.value = rate;
    next.connect(gain as never);
    next.onended = () => {
      // Only the node still in service may report the end of the track. A node
      // replaced by a seek fires this too, and letting it through would pause
      // playback that had just been restarted somewhere else.
      if (source !== next) return;
      source = null;
      clock = pausedAt(clock, context.currentTime);
    };
    next.start(0, fromSec);
    source = next;
  }

  return {
    isReady: () => track !== null,

    load: (_trackId, startSec) => {
      // The track was chosen on this machine, exactly as a local film is, so
      // the shared id cannot select anything here. Only the agreed start
      // position means something.
      if (track === null) return;
      const now = context.currentTime;
      clock = seekedTo(clock, now, startSec);
      if (clock.playing) startSource(clock.positionSec, clock.rate);
    },

    play: () => {
      if (track === null || clock.playing) return;
      // A context created before the first click starts suspended under the
      // browser's autoplay policy, and a suspended context advances no clock.
      void context.resume().catch(() => {});
      const now = context.currentTime;
      clock = resumedAt(clock, now);
      startSource(clock.positionSec, clock.rate);
    },

    pause: () => {
      if (!clock.playing) return;
      clock = pausedAt(clock, context.currentTime);
      stopSource();
    },

    seek: (seconds) => {
      const now = context.currentTime;
      clock = seekedTo(clock, now, seconds);
      if (clock.playing) startSource(clock.positionSec, clock.rate);
    },

    // Identical to seek, and that is the point. The distinction exists for
    // YouTube, where a seek may go to the network and empty the buffer while a
    // nudge stays inside what is already held. Decoded samples in memory have
    // no such cliff, so the sync layer's careful choice between them simply
    // stops mattering here.
    nudge: (seconds) => {
      const now = context.currentTime;
      clock = seekedTo(clock, now, seconds);
      if (clock.playing) startSource(clock.positionSec, clock.rate);
    },

    setRate: (rate) => {
      if (track === null) return false;
      // Refused rather than silently ignored: the drift corrector reads this
      // answer to decide whether to fall back to moving the playhead, and a
      // lie would leave two players apart with nothing to notice it.
      if (!Number.isFinite(rate) || rate <= 0) return false;
      clock = withRate(clock, context.currentTime, rate);
      // Changed on the live node, not by restarting it. Web Audio interpolates
      // the rate itself, which is what makes the correction inaudible.
      if (source !== null) source.playbackRate.value = rate;
      return true;
    },

    currentTime: () => positionAt(clock, context.currentTime),

    setVolume: (percent) => {
      const clamped = Math.min(100, Math.max(0, Math.round(percent)));
      volume = clamped;
      gain.gain.value = clamped / 100;
    },

    setTrack: (buffer) => {
      stopSource();
      track = buffer;
      const now = context.currentTime;
      clock = pausedAt(startedAt(buffer?.duration ?? 0, now, 0), now);
      // The volume belongs to this listener, not to the track, so a new song
      // must not arrive at full blast because it was chosen after the slider.
      gain.gain.value = volume / 100;
    },

    durationSec: () => track?.duration ?? 0,

    dispose: () => {
      stopSource();
      track = null;
      try {
        gain.disconnect();
      } catch {
        // Already detached. Nothing left to release.
      }
    },
  };
}
