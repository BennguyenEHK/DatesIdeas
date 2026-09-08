"use client";

import { useEffect, useRef, useState } from "react";
import { singingProfile, SPEECH_AUDIO, type AudioMode } from "./micProfile";
import type { MicSettings } from "./micState";
import {
  openMic,
  stopMic,
  swapMicTrack,
  type AudioSenderLike,
  type MicSource,
  type OpenedMic,
} from "./micSwap";
import { boostMic, type BoostedMic } from "./micGain";

/**
 * Releases a microphone this hook opened, and the processing stage on top of
 * it, in the order that leaves nothing running.
 *
 * The two are always created and destroyed together, so pairing them here is
 * what stops one of the six places that release a microphone from forgetting
 * the graph attached to it and leaving an audio context alive for the evening.
 */
function release(opened: OpenedMic | null, boost: BoostedMic | null): void {
  boost?.close();
  stopMic(opened);
}

export interface MicProfileState {
  /** What the live microphone actually became, for the report. */
  settings: MicSettings | null;
  /** Requested processing the device still refused, if any. */
  unmet: readonly string[];
  /** Why the swap could not happen, or null. */
  error: string | null;
  /** The track now being sent, so the level meter can follow it. */
  track: MediaStreamTrack | null;
}

const EMPTY_STATE: MicProfileState = {
  settings: null,
  unmet: [],
  error: null,
  track: null,
};

/**
 * The resolved-profile key meaning "give the call back its own microphone".
 *
 * It is deliberately not a profile at all. Ordinary talking used to resolve to
 * SPEECH_AUDIO here, and this hook would dutifully open a SECOND microphone
 * configured almost identically to the one the peer connection had already
 * opened -- from the moment the call connected, karaoke or not, for the whole
 * evening. Both captures ran at once on the same device.
 *
 * That is very likely why a live report showed the device settling at 44100Hz
 * when it used to be 48000Hz: the first stream holds the rate echo cancellation
 * forces, the second opens at whatever the hardware prefers, and everything
 * afterwards is resampled. It also costs a capture the machine gains nothing
 * from, and holds a device some machines will not open twice.
 *
 * The original microphone is already tuned for speech. Talking does not need a
 * replacement for it -- it needs the replacement to get out of the way.
 */
const ORIGINAL_MIC = "original";

/**
 * Owns microphones opened to change capture processing without touching the
 * original call microphone, which remains the peer connection's responsibility.
 */
export function useMicProfile(args: {
  /** The call's audio sender, or null before there is a call. */
  sender: AudioSenderLike | null;
  /** null means ordinary talking; a mode means singing. */
  mode: AudioMode | null;
  noisy: boolean;
  /**
   * The microphone the peer connection opened, to hand back when singing ends.
   *
   * This hook must never stop it -- it did not open it -- but it does have to
   * put it back on the sender, because the sender is carrying a track this hook
   * opened and is about to release. Without it there would be nothing to
   * restore to and the replacement would have to stay live forever, which is
   * the leak this exists to close.
   */
  original?: MediaStreamTrack | null;
  /**
   * Whether the microphone is switched on.
   *
   * Owned here because this hook is what opens the track. A freshly opened
   * microphone always arrives enabled, whatever the switch says, so somebody
   * has to put it back -- and it has to be whoever constructed it, or the mute
   * button and the device end up with two owners that disagree.
   */
  enabled?: boolean;
  /** Injected so this is testable; defaults to navigator.mediaDevices. */
  source?: MicSource | null;
}): MicProfileState {
  const [state, setState] = useState<MicProfileState>(EMPTY_STATE);
  const profile = args.mode === null ? SPEECH_AUDIO : singingProfile(args.mode, args.noisy);
  const profileKey = args.mode === null ? ORIGINAL_MIC : JSON.stringify(profile);
  const original = args.original ?? null;
  const source =
    args.source === undefined
      ? typeof navigator === "undefined"
        ? null
        : navigator.mediaDevices
      : args.source;

  // These sit above the effects that write them. The React Compiler rejects a
  // ref first written inside a closure declared above its declaration.
  const openedRef = useRef<OpenedMic | null>(null);
  const boostRef = useRef<BoostedMic | null>(null);
  const profileKeyRef = useRef<string | null>(null);
  const senderRef = useRef<AudioSenderLike | null>(null);
  const requestRef = useRef(0);
  const mountedRef = useRef(true);
  const enabledRef = useRef(args.enabled ?? true);

  useEffect(() => {
    // Set on every mount, not merely at declaration. React remounts components
    // -- StrictMode does it to every one of them in development -- and a flag
    // that is only ever turned off would leave the second mount convinced it
    // had already been discarded, stopping each microphone it opened and never
    // giving karaoke its singing profile at all.
    mountedRef.current = true;
    return () => {
      // Advancing the request makes an open that resolves after unmount lose
      // its right to join the call, so it can only release its own device.
      mountedRef.current = false;
      requestRef.current += 1;
      release(openedRef.current, boostRef.current);
      openedRef.current = null;
      boostRef.current = null;
      profileKeyRef.current = null;
      senderRef.current = null;
    };
  }, []);

  // The switch can move while a microphone is already open, and the track that
  // is live then is this hook's, not the peer connection's.
  useEffect(() => {
    // Remembered for the next microphone this hook opens, and applied to the
    // one already live. Written here rather than during render, where a ref
    // must not be touched at all.
    const on = args.enabled ?? true;
    enabledRef.current = on;
    const opened = openedRef.current;
    if (opened !== null) opened.track.enabled = on;
  }, [args.enabled]);

  useEffect(() => {
    const request = requestRef.current + 1;
    requestRef.current = request;

    if (args.sender === null) {
      // The sender has left the call, so this hook's replacement is no longer
      // useful. Never stop the original track, which this hook did not open.
      release(openedRef.current, boostRef.current);
      openedRef.current = null;
      boostRef.current = null;
      profileKeyRef.current = null;
      senderRef.current = null;
      queueMicrotask(() => {
        if (requestRef.current === request && mountedRef.current) {
          setState(EMPTY_STATE);
        }
      });
      return;
    }
    const sender = args.sender;

    // No openedRef check here on purpose. Handing the call's own microphone
    // back is a settled state that owns no device, so requiring one would make
    // this effect restore it again on every unrelated render.
    if (senderRef.current === sender && profileKeyRef.current === profileKey) {
      return;
    }

    if (profileKey === ORIGINAL_MIC) {
      const previous = openedRef.current;
      const previousBoost = boostRef.current;

      // Nothing of this hook's is on the call, so the original is already what
      // the sender is carrying. Record the state and open no device at all.
      if (previous === null) {
        profileKeyRef.current = ORIGINAL_MIC;
        senderRef.current = sender;
        queueMicrotask(() => {
          if (requestRef.current === request && mountedRef.current) {
            setState(EMPTY_STATE);
          }
        });
        return;
      }

      // There is a singing microphone live and nothing to put back in its
      // place. Keeping it is the lesser fault by a wide margin: a profile tuned
      // for the wrong activity is a worse-sounding call, and stopping the only
      // track the sender has is a silent one.
      if (original === null) return;

      const restore = async () => {
        const swapped = await swapMicTrack(sender, original);
        if (requestRef.current !== request || !mountedRef.current) return;
        if (!swapped) {
          // The sender still holds this hook's track, so it must stay live.
          setState((current) => ({ ...current, error: "restore failed" }));
          return;
        }
        // Only once the original is carrying the call again, for the same
        // reason the singing swap stops the old one last.
        openedRef.current = null;
        boostRef.current = null;
        profileKeyRef.current = ORIGINAL_MIC;
        senderRef.current = sender;
        release(previous, previousBoost);
        setState(EMPTY_STATE);
      };

      void restore();
      return;
    }

    if (source === null) {
      queueMicrotask(() => {
        if (requestRef.current === request && mountedRef.current) {
          setState((current) => ({ ...current, error: "unavailable" }));
        }
      });
      return;
    }

    const replace = async () => {
      const next = await openMic(source, profile);
      if (requestRef.current !== request || !mountedRef.current) {
        // A newer choice has already won. Releasing this stream prevents two
        // rapid profile changes from leaving the losing microphone running.
        stopMic(next);
        return;
      }

      if (next === null) {
        // The old microphone is still carrying the call, so an unavailable
        // replacement is evidence to report rather than a reason to mute it.
        setState((current) => ({ ...current, error: "unavailable" }));
        return;
      }

      // Puts back the loudness that switching automatic gain control off cost.
      //
      // That switch is why the high notes stopped cutting out, and it is not
      // coming back on. What it also took was about 14dB of level -- measured,
      // a session peak of 0.50 falling to 0.10 -- which arrives at the other
      // end as a voice buried under their own backing track. A slow compressor
      // and a fixed makeup gain restore the level without restoring the fast
      // envelope-chasing that made a held note swell and breathe.
      //
      // A browser that cannot build the graph returns null and the raw
      // microphone goes on the call unchanged, because quiet karaoke is a
      // disappointment and no microphone at all is a ruined evening.
      const boost = boostMic(next.track);
      const outgoing = boost === null ? next.track : boost.track;

      const swapped = await swapMicTrack(sender, outgoing);
      if (requestRef.current !== request || !mountedRef.current) {
        release(next, boost);
        return;
      }
      if (!swapped) {
        release(next, boost);
        setState((current) => ({ ...current, error: "replace failed" }));
        return;
      }

      // Before it is handed over, not after: a track that goes live enabled for
      // even one render is a muted microphone that briefly was not.
      //
      // Always the captured track, never the processed one. Disabling a source
      // feeds silence through the graph, which is the same result; disabling
      // the graph's output instead would leave the device live and recording
      // behind a switch that says it is off.
      next.track.enabled = enabledRef.current;

      const previous = openedRef.current;
      const previousBoost = boostRef.current;
      openedRef.current = next;
      boostRef.current = boost;
      profileKeyRef.current = profileKey;
      senderRef.current = sender;
      // Stop only after replacement. The sender then has a live track for the
      // whole handoff, and a device that needs the old handle stays available.
      release(previous, previousBoost);
      setState({
        settings: next.settings,
        unmet: next.unmet,
        error: null,
        // The processed track, so the level meter and the singing detector
        // both read what is actually being sent. The detector's thresholds are
        // the reason this matters: it decides whose music moves by comparing
        // against 0.06, and a raw 0.10 peak sits far too close to that line.
        track: outgoing,
      });
    };

    void replace();
  }, [args.sender, original, profile, profileKey, source]);

  return state;
}
