"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePeerConnection } from "@/lib/rtc/usePeerConnection";
import { useGestureDetection } from "@/lib/vision/useGestureDetection";
import { useSession } from "@/lib/history/useSession";
import { Ambience } from "@/components/Ambience";
import { Monogram } from "@/components/Monogram";
import { VideoStage } from "@/components/VideoStage";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { useMemeQueue } from "@/lib/ui/useMemeQueue";
import { QuestionCard } from "@/components/QuestionCard";
import { CardControls } from "@/components/CardControls";
import { useDeck } from "@/lib/cards/useDeck";
import { drawCard, type MoodFilter } from "@/lib/cards/draw";
import type { Card } from "@/lib/cards/types";
import { ActivityBar } from "@/components/ActivityBar";
import { TakeoverStage } from "@/components/TakeoverStage";
import { activity, activityKey, type ActivityId } from "@/lib/activities/registry";
import { shouldReplace } from "@/lib/sync/resolveSwap";
import { ActivityPlaceholder } from "@/components/ActivityPlaceholder";
import { KaraokePanel } from "@/components/KaraokePanel";
import { YouTubePlayer } from "@/components/YouTubePlayer";
import { useSyncedPlayback } from "@/lib/media/useSyncedPlayback";
import { tuneMicrophone, type AudioMode } from "@/lib/media/micProfile";
import type { PlayerHandle } from "@/lib/media/player";
import { usePersistentToggle } from "@/lib/ui/usePersistentToggle";
import type { MemeId, PeerMessage } from "@/lib/rtc/protocol";

/**
 * The call page is framed as a widescreen film still: every piece of interface
 * lives in the letterbox bars above and below the stage, so decoration can
 * never creep onto the video itself.
 */
export function RoomClient({ code }: { code: string }) {
  // One queue per tile: yours lands on your face, theirs on theirs.
  const mine = useMemeQueue();
  const theirs = useMemeQueue();
  // This device's own switch. Never sent to the peer, so turning it off here
  // leaves them free to keep gesturing — and leaves you still seeing them.
  const [gesturesOn, setGesturesOn] = usePersistentToggle(
    "datesidea.gestures",
    true,
  );
  const peerRef = useRef<ReturnType<typeof usePeerConnection> | null>(null);
  // Declared here, above the handlers that close over them. The playback hook
  // needs the peer's clock, so it cannot exist until after those handlers are
  // written -- only these two functions have to reach backwards, not the whole
  // result, which would make every read of it a ref read.
  const acceptMedia = useRef<((m: PeerMessage) => void) | null>(null);
  const clearMedia = useRef<(() => void) | null>(null);
  // Per session, never remembered. The question is what you are listening on
  // right now, and a stored answer from last week cannot know that.
  const [audioMode, setAudioMode] = useState<AudioMode | null>(null);
  // State, not a ref: a state setter is a valid callback ref and keeps the
  // player handle a plain value everywhere else.
  const [player, setPlayer] = useState<PlayerHandle | null>(null);

  const { deck } = useDeck();
  const [card, setCard] = useState<Card | null>(null);
  const [mood, setMood] = useState<MoodFilter>("all");
  // Every card either of you draws counts as seen on both sides, so the two
  // decks stay in step and neither of you is served a question twice.
  const seenRef = useRef(new Set<number>());
  // Both peers receive both messages when you tap Draw at the same instant.
  // Keeping the later showAt makes that deterministic: each side computes the
  // same winner independently, so they cannot end up on different questions.
  const cardSwap = useRef<{ showAt: number; key: number } | null>(null);

  const [current, setCurrent] = useState<ActivityId | null>(null);
  const activitySwap = useRef<{ showAt: number; key: number } | null>(null);

  const applyActivity = useCallback((id: ActivityId | null, showAt: number) => {
    // key -1 for "closed" keeps null orderable against the real activities.
    const key = id === null ? -1 : activityKey(id);
    if (!shouldReplace(activitySwap.current, { showAt, key })) return;
    activitySwap.current = { showAt, key };
    setCurrent(id);
    // Leaving karaoke drops the song and forgets the headphone answer. Done
    // here rather than in an effect watching `current`: this is the moment the
    // activity changes, and reacting to it afterwards is a cascading render.
    if (id !== "karaoke") {
      setAudioMode(null);
      clearMedia.current?.();
    }
  }, []);

  const showCard = useCallback((next: Card, showAt: number) => {
    if (!shouldReplace(cardSwap.current, { showAt, key: next.id })) return;
    cardSwap.current = { showAt, key: next.id };
    seenRef.current.add(next.id);
    setCard(next);
  }, []);

  const onMessage = useCallback(
    (msg: PeerMessage) => {
      if (msg.t === "media") {
        acceptMedia.current?.(msg);
        return;
      }
      if (msg.t === "activity") {
        const clock = peerRef.current?.clock;
        if (!clock) {
          applyActivity(msg.id, msg.showAt);
          return;
        }
        clock.scheduleAt(msg.showAt, () => applyActivity(msg.id, msg.showAt));
        return;
      }
      if (msg.t === "card") {
        const next: Card = { id: msg.cardId, text: msg.text, mood: msg.mood };
        const clock = peerRef.current?.clock;
        if (!clock) {
          showCard(next, msg.showAt);
          return;
        }
        clock.scheduleAt(msg.showAt, () => showCard(next, msg.showAt));
        return;
      }
      if (msg.t !== "meme") return;
      const clock = peerRef.current?.clock;
      // Scheduled, not immediate: both screens land on the same instant. With
      // no clock there is no shared instant to aim at, so show it now rather
      // than dropping it.
      if (!clock) {
        theirs.show(msg.id);
        return;
      }
      clock.scheduleAt(msg.showAt, () => theirs.show(msg.id));
    },
    [theirs, showCard, applyActivity],
  );

  const peer = usePeerConnection(code, onMessage);
  useEffect(() => {
    peerRef.current = peer;
  });

  const session = useSession(code, peer.state === "connected");

  const onGesture = useCallback(
    (id: MemeId) => {
      session.recordMeme(id);
      const clock = peerRef.current?.clock;
      // No channel yet. Returning here used to swallow the gesture whole, so a
      // working detector was indistinguishable from a broken one. Show it
      // locally: they cannot see it, but you can see that it fired.
      if (!clock) {
        mine.show(id);
        return;
      }
      const showAt = clock.now() + clock.leadTime();
      peerRef.current?.send({ t: "meme", id, showAt });
      // The sender schedules too. Rendering now would be faster but would break
      // the symmetry the design requires.
      clock.scheduleAt(showAt, () => mine.show(id));
    },
    [session, mine],
  );

  const media = useSyncedPlayback(player, peer.clock, peer.send);
  useEffect(() => {
    acceptMedia.current = media.accept;
    clearMedia.current = media.clear;
  });

  const karaoke = current === "karaoke";

  // Gesture detection is paused during karaoke: your hands are busy holding a
  // hairbrush, and MediaPipe on top of a video stream is real work for a
  // laptop already running a call.
  const gesture = useGestureDetection(
    peer.localStream,
    onGesture,
    gesturesOn && !karaoke,
  );
  const kind = current === null ? "companion" : activity(current).kind;

  // Retune the live microphone to match how the song is being heard. On
  // speakers echo cancellation stays on, since it is the only thing stopping
  // the microphone sending back a second copy of the song.
  useEffect(() => {
    void tuneMicrophone(peer.localStream, karaoke ? audioMode : null);
  }, [peer.localStream, karaoke, audioMode]);



  const onSelectActivity = useCallback(
    (id: ActivityId | null) => {
      const clock = peerRef.current?.clock;
      const showAt = clock ? clock.now() + clock.leadTime() : Date.now();
      peerRef.current?.send({ t: "activity", id, showAt });
      // Scheduled on both sides so the evening turns over together.
      if (clock) clock.scheduleAt(showAt, () => applyActivity(id, showAt));
      else applyActivity(id, showAt);
    },
    [applyActivity],
  );

  const onDraw = useCallback(() => {
    const drawn = drawCard(deck, seenRef.current, mood, Math.random, card?.id);
    if (!drawn) return;
    if (drawn.reshuffled) seenRef.current.clear();

    const clock = peerRef.current?.clock;
    const showAt = clock ? clock.now() + clock.leadTime() : Date.now();
    peerRef.current?.send({
      t: "card",
      cardId: drawn.card.id,
      text: drawn.card.text,
      mood: drawn.card.mood,
      showAt,
    });
    // Scheduled on both sides, like the memes, so the question turns over at
    // the same moment for both of you.
    if (clock) clock.scheduleAt(showAt, () => showCard(drawn.card, showAt));
    else showCard(drawn.card, showAt);
  }, [deck, mood, card, showCard]);

  return (
    <>
      <Ambience />
      <div className="flex min-h-screen flex-1 flex-col">
        {/* Top letterbox bar */}
        <header className="bar-top flex flex-wrap items-center justify-between gap-x-3 gap-y-2 bg-[var(--letterbox)] px-5 py-3">
          <Monogram size="compact" />
          <ActivityBar current={current} onSelect={onSelectActivity} />
          <span className="font-[family-name:var(--font-display)] text-sm tracking-[0.45em] text-[var(--lamp)]">
            {code}
          </span>
        </header>

        {/* The stage */}
        <main className="flex flex-1 items-center justify-center px-4 py-6 md:px-8">
          <div className="w-full max-w-6xl">
            {/* The stage takes one of two shapes. A film is the only thing
                that should be larger than a face; everything else here IS the
                faces, so it stays companion-sized with the activity beneath. */}
            {kind === "takeover" ? (
              <TakeoverStage
                local={peer.localStream}
                remote={peer.remoteStream}
                localMemes={mine.memes}
                remoteMemes={theirs.memes}
                mediaError={peer.mediaError}
              >
                {karaoke ? (
                  <YouTubePlayer ref={setPlayer} />
                ) : (
                  <ActivityPlaceholder id={current} />
                )}
              </TakeoverStage>
            ) : (
              <>
                <VideoStage
                  local={peer.localStream}
                  remote={peer.remoteStream}
                  localMemes={mine.memes}
                  remoteMemes={theirs.memes}
                  mediaError={peer.mediaError}
                />
                {current === "cards" && (
                  <QuestionCard card={card} onDismiss={() => setCard(null)} />
                )}
                {current !== null && current !== "cards" && (
                  <ActivityPlaceholder id={current} />
                )}
              </>
            )}
          </div>
        </main>

        {/* Bottom letterbox bar */}
        <footer className="bar-bottom bg-[var(--letterbox)] px-5 py-3">
          <ConnectionStatus
            state={peer.state}
            path={peer.path}
            sending={peer.sending}
            rtt={peer.rtt}
            jitterMs={peer.jitterMs}
            gestureReady={gesture.ready}
            gestureError={gesture.error}
            gesturesOn={gesturesOn}
            onToggleGestures={setGesturesOn}
            onRetry={peer.retry}
          />
          {karaoke && (
            <KaraokePanel
              videoId={media.videoId}
              playing={media.playing}
              audioMode={audioMode}
              onChooseAudio={setAudioMode}
              onLoad={media.load}
              onPlayPause={media.playPause}
              onResync={media.resync}
              onClear={media.clear}
            />
          )}

          {current === "cards" && (
            <CardControls
              mood={mood}
              onMood={setMood}
              onDraw={onDraw}
              disabled={deck.length === 0}
              hasCard={card !== null}
            />
          )}
        </footer>
      </div>
    </>
  );
}
