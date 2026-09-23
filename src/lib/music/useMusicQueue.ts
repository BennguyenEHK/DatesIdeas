"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Film } from "@/lib/media/sync";
import type { PeerMessage } from "@/lib/rtc/protocol";
import {
  EMPTY_MUSIC,
  acceptRemote,
  addTracks,
  currentTrack,
  jumpTo,
  next as nextTrack,
  previous as previousTrack,
  removeAt,
  setTitles as withTitles,
  stop as stopTrack,
  toMessage,
  type MusicState,
} from "./queue";
import { fetchTitles } from "./titles";

/** The protocol refuses a longer name for whoever added a song. */
const ADDED_BY_MAX = 64;

export interface MusicQueue {
  state: MusicState;
  /**
   * The newest state, for event handlers.
   *
   * `state` is what the last render saw. A handler that runs after a message
   * has arrived but before the re-render -- a song ending, say -- has to decide
   * against what is true now, not against what was drawn.
   */
  peek: () => MusicState;
  add: (videoIds: string[]) => MusicState;
  remove: (at: number) => MusicState;
  jump: (at: number) => MusicState;
  /** `from` is the track this move leaves; see `next` in queue.ts. */
  next: (from?: number | null) => MusicState;
  previous: () => MusicState;
  /** Keeps the list and plays nothing, for karaoke and the film. */
  stop: () => MusicState;
  setTitles: (titles: Record<string, string>) => MusicState;
  /** Feed inbound peer messages here; anything but `music` is ignored. */
  accept: (message: PeerMessage) => void;
  /** Tells somebody who has just (re)joined what the queue is. */
  resync: () => void;
}

/**
 * Tonight's music queue, shared with the other screen.
 *
 * Every change is applied here first and then sent whole. The operations
 * return the resulting state so the caller can act on it at once -- load the
 * song that is now current -- without waiting for a render.
 *
 * Only the list travels in these messages. What the players are actually
 * playing is the shared `media` state, and moving from one to the other is the
 * caller's job (see `useMusicControls`), so a message arriving from the other
 * screen never makes this screen broadcast anything back.
 */
export function useMusicQueue({
  send,
  identity,
  now,
}: {
  send: (message: PeerMessage) => void;
  identity: string;
  /** Shared-clock time, which is what decides a tie between two changes. */
  now: () => number;
}): MusicQueue {
  const [state, setState] = useState<MusicState>(EMPTY_MUSIC);
  // Read by handlers outside render; kept in step with every change made.
  const latest = useRef<MusicState>(EMPTY_MUSIC);
  const mounted = useRef(true);

  const sendRef = useRef(send);
  const identityRef = useRef(identity);
  const nowRef = useRef(now);
  useEffect(() => {
    sendRef.current = send;
    identityRef.current = identity;
    nowRef.current = now;
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /**
   * Adopts a changed state and sends it.
   *
   * The pure operations hand back the very same object when nothing changed,
   * so that is the test: a no-op sends nothing, and above all does not move
   * the revision on and win against a real change from the other screen.
   */
  const commit = useCallback((next: MusicState): MusicState => {
    if (next === latest.current) return next;
    const stamped = { ...next, sentAt: nowRef.current() };
    latest.current = stamped;
    setState(stamped);
    sendRef.current(toMessage(stamped, stamped.sentAt));
    return stamped;
  }, []);

  const setTitles = useCallback(
    (titles: Record<string, string>) =>
      commit(withTitles(latest.current, titles)),
    [commit],
  );

  const add = useCallback(
    (videoIds: string[]) => {
      const addedBy = identityRef.current.slice(0, ADDED_BY_MAX);
      const result = commit(
        addTracks(
          latest.current,
          videoIds.map((videoId) => ({ videoId, title: null, addedBy })),
        ),
      );
      // Whoever added the songs looks their titles up, and sends the queue
      // once more with all of them filled in rather than once per title.
      const untitled = result.queue
        .filter(
          (track) => track.title === null && videoIds.includes(track.videoId),
        )
        .map((track) => track.videoId);
      if (untitled.length > 0) {
        void fetchTitles(untitled).then((titles) => {
          if (mounted.current && Object.keys(titles).length > 0) {
            setTitles(titles);
          }
        });
      }
      return result;
    },
    [commit, setTitles],
  );

  const remove = useCallback(
    (at: number) => commit(removeAt(latest.current, at)),
    [commit],
  );
  const jump = useCallback(
    (at: number) => commit(jumpTo(latest.current, at)),
    [commit],
  );
  const next = useCallback(
    (from?: number | null) =>
      commit(
        nextTrack(
          latest.current,
          from === undefined ? latest.current.index : from,
        ),
      ),
    [commit],
  );
  const previous = useCallback(
    () => commit(previousTrack(latest.current)),
    [commit],
  );
  const stop = useCallback(() => commit(stopTrack(latest.current)), [commit]);

  const accept = useCallback((message: PeerMessage) => {
    if (message.t !== "music") return;
    const merged = acceptRemote(latest.current, message);
    if (merged === latest.current) return;
    latest.current = merged;
    setState(merged);
  }, []);

  const resync = useCallback(() => {
    const cur = latest.current;
    if (cur.queue.length === 0) return;
    sendRef.current(toMessage(cur, cur.sentAt));
  }, []);

  const peek = useCallback(() => latest.current, []);

  return {
    state,
    peek,
    add,
    remove,
    jump,
    next,
    previous,
    stop,
    setTitles,
    accept,
    resync,
  };
}

/** The parts of `useSyncedPlayback` the music bar drives. */
export interface MusicPlayback {
  videoId: string | null;
  playing: boolean;
  load: (film: Film, startSec?: number) => void;
  playPause: () => void;
  seek: (seconds: number) => void;
  clear: () => void;
}

export interface MusicControls {
  onAdd: (videoIds: string[]) => void;
  onRemove: (at: number) => void;
  onJump: (at: number) => void;
  onNext: () => void;
  onPrevious: () => void;
  onPlayPause: () => void;
  onSeekBy: (deltaSeconds: number) => void;
  onEnded: (videoId: string | null) => void;
}

/**
 * Joins the queue to the shared player: whenever this person's action changes
 * which song is current, the player is loaded with it.
 *
 * Only this person's own actions come through here. A queue arriving from the
 * other screen is not followed by loading anything, because the other screen
 * loads it itself and its `media` message brings this player along.
 *
 * `positionSec` reads where the song is now, for skipping ten seconds.
 */
export function useMusicControls(
  music: MusicQueue,
  playback: MusicPlayback,
  positionSec: () => number,
): MusicControls {
  /**
   * Puts the current song on the player if it is not there already.
   *
   * `play` starts it; otherwise it is only cued. An emptied queue clears the
   * player, since the song it was holding is no longer anyone's choice.
   */
  function follow(state: MusicState, play: boolean) {
    const track = currentTrack(state);
    if (track === null) {
      if (playback.videoId !== null) playback.clear();
      return;
    }
    if (track.videoId === playback.videoId) return;
    playback.load(
      { videoId: track.videoId, source: "youtube", durationSec: null },
      0,
    );
    if (play) playback.playPause();
  }

  return {
    onAdd: (videoIds) => {
      const wasIdle = music.peek().index === null;
      const state = music.add(videoIds);
      // The first song of the evening starts by itself: pasting it is the
      // request to hear it. Later songs wait their turn.
      if (wasIdle) follow(state, true);
    },
    onRemove: (at) => follow(music.remove(at), playback.playing),
    onJump: (at) => follow(music.jump(at), true),
    onNext: () => follow(music.next(), playback.playing),
    onPrevious: () => follow(music.previous(), playback.playing),
    onPlayPause: () => {
      if (playback.videoId !== null) {
        playback.playPause();
        return;
      }
      // Nothing on the player: back from karaoke or the film with the queue
      // resting. Play starts it where it was, or at the top.
      const state = music.peek();
      if (state.queue.length === 0) return;
      follow(state.index === null ? music.jump(0) : state, true);
    },
    onSeekBy: (deltaSeconds) => playback.seek(positionSec() + deltaSeconds),
    onEnded: (videoId) => {
      const state = music.peek();
      // Already moved on by the other screen, whose `media` message is on its
      // way: moving on again here would skip a song nobody heard.
      if (state.index === null || state.queue[state.index]?.videoId !== videoId)
        return;
      follow(music.next(state.index), true);
    },
  };
}
