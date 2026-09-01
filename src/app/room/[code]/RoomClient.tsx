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

  const { deck } = useDeck();
  const [card, setCard] = useState<Card | null>(null);
  const [mood, setMood] = useState<MoodFilter>("all");
  // Every card either of you draws counts as seen on both sides, so the two
  // decks stay in step and neither of you is served a question twice.
  const seenRef = useRef(new Set<number>());
  // Both peers receive both messages when you tap Draw at the same instant.
  // Keeping the later showAt makes that deterministic: each side computes the
  // same winner independently, so they cannot end up on different questions.
  const cardShownAt = useRef(-Infinity);

  const cardRef = useRef<Card | null>(null);
  useEffect(() => {
    cardRef.current = card;
  });

  const showCard = useCallback((next: Card, showAt: number) => {
    if (showAt < cardShownAt.current) return;
    // Same instant: lowest id wins. Arbitrary, but both peers apply the same
    // rule to the same two messages, which is all determinism requires.
    if (showAt === cardShownAt.current && next.id > (cardRef.current?.id ?? -1)) return;
    cardShownAt.current = showAt;
    seenRef.current.add(next.id);
    setCard(next);
  }, []);

  const onMessage = useCallback(
    (msg: PeerMessage) => {
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
    [theirs, showCard],
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

  const gesture = useGestureDetection(peer.localStream, onGesture, gesturesOn);

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
        <header className="bar-top flex items-center justify-between bg-[var(--letterbox)] px-5 py-3">
          <Monogram size="compact" />
          <span className="font-[family-name:var(--font-display)] text-sm tracking-[0.45em] text-[var(--lamp)]">
            {code}
          </span>
        </header>

        {/* The stage */}
        <main className="flex flex-1 items-center justify-center px-4 py-6 md:px-8">
          <div className="w-full max-w-6xl">
            <VideoStage
              local={peer.localStream}
              remote={peer.remoteStream}
              localMemes={mine.memes}
              remoteMemes={theirs.memes}
              mediaError={peer.mediaError}
            />
            <QuestionCard card={card} onDismiss={() => setCard(null)} />
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
          <CardControls
            mood={mood}
            onMood={setMood}
            onDraw={onDraw}
            disabled={deck.length === 0}
            hasCard={card !== null}
          />
        </footer>
      </div>
    </>
  );
}
