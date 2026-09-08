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
  const profileKey = JSON.stringify(profile);
  const source =
    args.source === undefined
      ? typeof navigator === "undefined"
        ? null
        : navigator.mediaDevices
      : args.source;

  // These sit above the effects that write them. The React Compiler rejects a
  // ref first written inside a closure declared above its declaration.
  const openedRef = useRef<OpenedMic | null>(null);
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
      stopMic(openedRef.current);
      openedRef.current = null;
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
      stopMic(openedRef.current);
      openedRef.current = null;
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

    if (
      openedRef.current !== null &&
      senderRef.current === sender &&
      profileKeyRef.current === profileKey
    ) {
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

      const swapped = await swapMicTrack(sender, next.track);
      if (requestRef.current !== request || !mountedRef.current) {
        stopMic(next);
        return;
      }
      if (!swapped) {
        stopMic(next);
        setState((current) => ({ ...current, error: "replace failed" }));
        return;
      }

      // Before it is handed over, not after: a track that goes live enabled for
      // even one render is a muted microphone that briefly was not.
      next.track.enabled = enabledRef.current;

      const previous = openedRef.current;
      openedRef.current = next;
      profileKeyRef.current = profileKey;
      senderRef.current = sender;
      // Stop only after replacement. The sender then has a live track for the
      // whole handoff, and a device that needs the old handle stays available.
      stopMic(previous);
      setState({
        settings: next.settings,
        unmet: next.unmet,
        error: null,
        track: next.track,
      });
    };

    void replace();
  }, [args.sender, profile, profileKey, source]);

  return state;
}
