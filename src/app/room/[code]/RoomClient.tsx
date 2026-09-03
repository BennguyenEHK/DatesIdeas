"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePeerConnection } from "@/lib/rtc/usePeerConnection";
import { useGestureDetection } from "@/lib/vision/useGestureDetection";
import { useSession } from "@/lib/history/useSession";
import { Ambience } from "@/components/Ambience";
import { Wordmark } from "@/components/Wordmark";
import { CopyLink } from "@/components/CopyLink";
import { RoomClosed } from "@/components/RoomClosed";
import { fetchRoomStatus, type RoomInfo } from "@/lib/room/api";
import { formatRemaining, remainingMs } from "@/lib/room/lifetime";
import { useCreateRoom } from "@/lib/room/useCreateRoom";
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
import { theme as themeById } from "@/lib/photo/themes";
import { shouldReplace } from "@/lib/sync/resolveSwap";
import { ActivityPlaceholder } from "@/components/ActivityPlaceholder";
import { KaraokePanel } from "@/components/KaraokePanel";
import { MoviePanel } from "@/components/MoviePanel";
import { LocalFilePlayer } from "@/components/LocalFilePlayer";
import { PhotoBoothStage } from "@/components/PhotoBoothStage";
import { PhotoBoothPanel } from "@/components/PhotoBoothPanel";
import { PhotoStrip } from "@/components/PhotoStrip";
import { useBooth } from "@/lib/photo/useBooth";
import { YouTubePlayer } from "@/components/YouTubePlayer";
import { useSyncedPlayback } from "@/lib/media/useSyncedPlayback";
import { tuneMicrophone } from "@/lib/media/micProfile";
import { useOutputMode } from "@/lib/media/outputDevice";
import { useSingingTurn } from "@/lib/media/useSingingTurn";
import {
  measuredLatencyMs,
  offsetForTurn,
  settledOffset,
  singingTurn,
  smoothLatency,
} from "@/lib/media/singerTurn";
import type { PlayerHandle } from "@/lib/media/player";
import type { SyncPrecision } from "@/lib/media/sync";
import { useVolumeDuck } from "@/lib/media/useVolumeDuck";
import { worthDucking } from "@/lib/media/duck";
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
  const [videoError, setVideoError] = useState<number | null>(null);
  // Local to this side, never sent. Starts below full because the reported
  // problem was the backing track burying the other person's voice.
  const [musicVolume, setMusicVolume] = useState(70);
  // Whether this room is loud. A separate question from where the song is
  // playing: in a noisy room the microphone processing that ruins singing is
  // the same processing keeping the singing audible at all.
  const [noisy, setNoisy] = useState(false);
  // Browsing for the next song. Local on purpose — opening the picker used to
  // clear the video through shared state, which cut the other person off
  // mid-verse just because you went looking for the next track.
  const [picking, setPicking] = useState(false);
  // Pulls this side's music back so their voice lands on the beat. Local, and
  // never sent: if it were shared, both sides would shift by the same amount
  // and the gap between them would be exactly where it started.
  const [offsetMs, setOffsetMs] = useState(0);
  // Ticked, the figure above belongs to whoever is listening rather than to the
  // measurement. Nothing here overrules a person who has taken the wheel.
  const [manualOffset, setManualOffset] = useState(false);
  // A short window of readings rather than the newest one, so a single packet
  // caught behind a burst of traffic cannot lurch the song.
  const latencySamples = useRef<number[]>([]);
  // This side's own copy of the film. Never sent: a feature film is gigabytes
  // and this connection carries a few hundred kilobytes a second, so each side
  // opens its own and only the position travels.
  const [movieFile, setMovieFile] = useState<File | null>(null);
  const [myDuration, setMyDuration] = useState<number | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [movieVolume, setMovieVolume] = useState(100);
  // Handed down to the booth stage and back up here, because the capture has
  // to read pixels out of these exact elements rather than the streams.
  const localVideo = useRef<HTMLVideoElement | null>(null);
  const remoteVideo = useRef<HTMLVideoElement | null>(null);
  const acceptPhoto = useRef<((m: PeerMessage) => void) | null>(null);
  const acceptSinging = useRef<((m: PeerMessage) => void) | null>(null);
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
    // Karaoke and movie share one player and one shared position, so the film
    // is dropped only when leaving BOTH of them -- switching between the two
    // still starts fresh, which is why the source is cleared either way. Done
    // here rather than in an effect watching `current`: this is the moment the
    // activity changes, and reacting to it afterwards is a cascading render.
    // The delay belongs to karaoke alone. Carrying it into the film that comes
    // next would leave the player sitting behind the shared position with
    // nothing on screen to explain why.
    if (id !== "karaoke") {
      latencySamples.current = [];
      setOffsetMs(0);
      setManualOffset(false);
    }
    if (id !== "karaoke" && id !== "movie") {
      setVideoError(null);
      setFileError(null);
      setMovieFile(null);
      setMyDuration(null);
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
      if (msg.t === "photo") {
        acceptPhoto.current?.(msg);
        return;
      }
      if (msg.t === "singing") {
        acceptSinging.current?.(msg);
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

  // A film and a song want opposite things from the same machinery. Half a
  // second apart is invisible in a film and a third of a beat is not, and on
  // YouTube every correction is a seek -- so holding a movie to the song's
  // standard bought nothing anyone could perceive and paid for it in stutters.
  const precision: SyncPrecision = current === "movie" ? "watching" : "singing";
  const media = useSyncedPlayback(
    player,
    peer.clock,
    peer.send,
    offsetMs / 1000,
    precision,
  );
  useEffect(() => {
    acceptMedia.current = media.accept;
    clearMedia.current = media.clear;
  });

  // Stamped along the bottom of every strip: the evening it came from. The
  // code lasts a day and will never exist again, which is what turns a collage
  // into a keepsake.
  const booth = useBooth({
    clock: peer.clock,
    send: peer.send,
    localVideo,
    remoteVideo,
    caption: `${new Date()
      .toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
      .toUpperCase()}  ·  ${code}`,
  });
  useEffect(() => {
    acceptPhoto.current = booth.accept;
  });

  const karaoke = current === "karaoke";
  const movie = current === "movie";
  const photobooth = current === "photobooth";

  // No karaoke exception. Pausing gestures there meant the status bar had a
  // state it could not name and reported a warm-up that would never finish --
  // and reactions are worth more mid-song than the CPU they cost.
  const gesture = useGestureDetection(peer.localStream, onGesture, gesturesOn);
  const kind = current === null ? "companion" : activity(current).kind;

  // Applied here rather than through the sync layer: loudness is this side's
  // alone, and routing it through shared state would push it to the peer.
  useEffect(() => {
    player?.setVolume(movie ? movieVolume : musicVolume);
  }, [player, movie, movieVolume, musicVolume]);

  // The camera goes on a leash for karaoke and comes straight off afterwards.
  //
  // Video is greedy and does not care who else is using the link. On a relayed
  // intercontinental path an uncapped 720p stream is enough to push the voice
  // into clumps, and the browser answers clumpy audio by holding MORE of it
  // back — so the picture quietly costs the singing twice. Every other
  // activity keeps full quality, because only singing is ruined by that delay:
  // cards is a conversation, a film is watched, and the photo booth builds its
  // pictures locally from frames delay cannot touch.
  //
  // Re-applied whenever the connection comes back, because a restart replaces
  // the senders and a leash tied to the old ones goes with them.
  //
  // Pulled out as locals so the effect depends on the two things it actually
  // uses. Depending on `peer` would re-run it on every render, since the hook
  // returns a fresh object each time.
  const { state: peerState, setVideoMode } = peer;
  useEffect(() => {
    if (peerState !== "connected") return;
    setVideoMode(karaoke ? "lean" : "full");
  }, [karaoke, peerState, setVideoMode]);

  // Which of you is listening on what. Asked of the operating system rather
  // than of the person: the answer is already sitting in the device list, and
  // a question standing between someone and the song is a worse way to get it.
  const audio = useOutputMode(karaoke);

  // Retune the live microphone to match how the song is being heard, and how
  // loud the room is. On speakers echo cancellation stays on, since it is the
  // only thing stopping the microphone sending back a second copy of the song;
  // in a noisy room noise suppression goes back on, because otherwise the
  // canceller is left picking a voice out of a crowd and clamps down on both.
  useEffect(() => {
    void tuneMicrophone(peer.localStream, karaoke ? audio.mode : null, noisy);
  }, [peer.localStream, karaoke, audio.mode, noisy]);

  // Who is actually singing, which is the only thing that can decide whose
  // music moves. Both sides run this, and each tells the other.
  const singing = useSingingTurn({
    stream: peer.localStream,
    send: peer.send,
    enabled: karaoke,
  });
  useEffect(() => {
    acceptSinging.current = singing.accept;
  });

  const turn = singingTurn(singing.mine, singing.theirs);

  // How late their voice arrives: half the round trip, plus however long their
  // audio is sitting in this browser's jitter buffer. Measured continuously,
  // because a connection at nine in the evening is not the one you tuned to by
  // ear at seven -- but only RECORDED here, never applied. Nothing in this
  // effect moves the player.
  //
  // Measured at the ICE layer where one is available. `peer.rtt` times a
  // DataChannel message, which travels through JavaScript -- so a main thread
  // busy with gesture detection inflates it, and the music would then be
  // rewound to accommodate our own CPU rather than the distance to Surabaya.
  // The browser's own figure is taken below JavaScript and cannot be fooled.
  const netRtt = peer.path?.netRtt ?? null;
  useEffect(() => {
    if (!karaoke) return;
    const sample = measuredLatencyMs(netRtt ?? peer.rtt, peer.audioJitterMs);
    if (sample === null) return;
    latencySamples.current = [...latencySamples.current, sample].slice(-9);
  }, [karaoke, netRtt, peer.rtt, peer.audioJitterMs]);

  // The delay is decided once, when the turn changes hands, and then held for
  // the whole of that turn.
  //
  // It used to be recomputed every time the connection was remeasured, which
  // meant the figure crept while someone was mid-verse and the player kept
  // being pulled to a new position underneath them. Even a correction too
  // small to hear accumulates until it crosses the drift tolerance, and then
  // the song jumps. A turn boundary is the one moment when a change is free:
  // by definition somebody has just stopped singing, so there is nothing for
  // the correction to interrupt.
  //
  // `turn` is the only dependency, which is the whole point: the connection is
  // remeasured every couple of seconds and none of those readings reach the
  // player any more.
  //
  // The change is applied inside a dip in the music rather than on top of it.
  // YouTube cannot glide into a new position — the only correction it accepts
  // is a seek, which stops and restarts the decoder — so the jump is hidden
  // under a moment of silence instead of being smoothed away. A change too
  // small to hear skips the dip: there the cure costs more than the disease.
  const duck = useVolumeDuck(player, musicVolume);
  const offsetRef = useRef(offsetMs);
  useEffect(() => {
    offsetRef.current = offsetMs;
  });
  useEffect(() => {
    if (!karaoke || manualOffset) return;
    const wanted = offsetForTurn(turn, smoothLatency(latencySamples.current));
    const next = settledOffset(offsetRef.current, wanted);
    if (next === offsetRef.current) return;
    if (!worthDucking((next - offsetRef.current) / 1000)) {
      setOffsetMs(next);
      return;
    }
    duck(() => setOffsetMs(next));
  }, [karaoke, manualOffset, turn, duck]);



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

  // Opening the next room, for when this one has closed.
  const newRoom = useCreateRoom();
  // Asked once on arrival for the countdown, and again the moment signalling
  // reports the room gone — that second answer is what separates "this evening
  // has ended" from "there is no such code", which need different replies.
  const [room, setRoom] = useState<RoomInfo | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchRoomStatus(code).then((info) => {
      if (!cancelled) setRoom(info);
    });
    return () => {
      cancelled = true;
    };
  }, [code, peer.roomClosed]);

  const left = room?.expiresAt ? remainingMs(room.expiresAt) : 0;
  const closesIn = left > 0 ? formatRemaining(left) : null;

  if (peer.roomClosed) {
    return (
      <RoomClosed
        // Until the second answer arrives, "expired" is the likelier of the
        // two and the gentler thing to be told.
        status={room?.status === "missing" ? "missing" : "expired"}
        code={code}
        onStart={() => void newRoom.start()}
        pending={newRoom.pending}
        error={newRoom.error}
      />
    );
  }

  return (
    <>
      <Ambience />
      <div className="flex min-h-screen flex-1 flex-col">
        {/* Top letterbox bar */}
        <header className="bar-top flex flex-wrap items-center justify-between gap-x-3 gap-y-2 bg-[var(--letterbox)] px-5 py-3">
          <Wordmark size="compact" />
          <ActivityBar current={current} onSelect={onSelectActivity} />
          <CopyLink code={code} closesIn={closesIn} />
        </header>

        {/* The stage.

            A column rather than a centred box: the stage claims every pixel of
            height left between the two letterbox bars, and a companion panel
            below takes its own natural height out of that. min-h-0 is what
            allows the flex child to shrink — without it the stage refuses to go
            below its content size and pushes the card off the bottom. */}
        <main className="flex min-h-0 flex-1 flex-col items-center gap-4 px-4 py-4 md:px-8">
          <div className="flex min-h-0 w-full flex-1 items-center justify-center">
            {/* The stage takes one of two shapes. A film is the only thing
                that should be larger than a face; everything else here IS the
                faces, so it stays companion-sized with the activity beneath. */}
            {photobooth ? (
              <PhotoBoothStage
                theme={themeById(booth.themeId)}
                local={peer.localStream}
                remote={peer.remoteStream}
                localMemes={mine.memes}
                remoteMemes={theirs.memes}
                count={booth.count}
                flashing={booth.flashing}
                review={booth.review}
                shots={booth.shots}
                localVideoRef={localVideo}
                remoteVideoRef={remoteVideo}
              >
                <PhotoStrip
                  url={booth.stripUrl}
                  busy={booth.busy}
                  onSave={booth.save}
                  onDiscard={booth.discard}
                />
              </PhotoBoothStage>
            ) : kind === "takeover" ? (
              <TakeoverStage
                local={peer.localStream}
                remote={peer.remoteStream}
                localMemes={mine.memes}
                remoteMemes={theirs.memes}
                mediaError={peer.mediaError}
              >
                {karaoke || (movie && media.film.source === "youtube") ? (
                  <YouTubePlayer ref={setPlayer} onError={setVideoError} />
                ) : movie ? (
                  <LocalFilePlayer
                    ref={setPlayer}
                    file={movieFile}
                    onDuration={(seconds) => {
                      setMyDuration(seconds);
                      // Only the side that chose the film reports its length;
                      // the hook enforces that, so this is safe to call from
                      // both.
                      if (seconds !== null) media.reportDuration(seconds);
                    }}
                    onError={setFileError}
                  />
                ) : (
                  <ActivityPlaceholder id={current} />
                )}
              </TakeoverStage>
            ) : (
              <VideoStage
                local={peer.localStream}
                remote={peer.remoteStream}
                localMemes={mine.memes}
                remoteMemes={theirs.memes}
                mediaError={peer.mediaError}
              />
            )}
          </div>

          {/* Companion activities sit under the faces. shrink-0 so the card
              keeps its full height and the video gives way instead — the
              question is the point of the cards evening, not the wallpaper. */}
          {kind !== "takeover" && current === "cards" && (
            <div className="w-full max-w-4xl shrink-0">
              <QuestionCard card={card} onDismiss={() => setCard(null)} />
            </div>
          )}
          {kind !== "takeover" && current !== null && current !== "cards" && (
            <div className="w-full max-w-4xl shrink-0">
              <ActivityPlaceholder id={current} />
            </div>
          )}
        </main>

        {/* Bottom letterbox bar */}
        <footer className="bar-bottom bg-[var(--letterbox)] px-5 py-3">
          <ConnectionStatus
            state={peer.state}
            path={peer.path}
            sending={peer.sending}
            rtt={peer.rtt}
            jitterMs={peer.jitterMs}
            audioJitterMs={peer.audioJitterMs}
            audioFormat={peer.audioFormat}
            audioKbps={peer.audioKbps}
            gestureReady={gesture.ready}
            gestureError={gesture.error}
            gesturesOn={gesturesOn}
            onToggleGestures={setGesturesOn}
            onReport={() => peer.report(current)}
            onRetry={peer.retry}
          />
          {photobooth && (
            <PhotoBoothPanel
              themeId={booth.themeId}
              onTheme={booth.setThemeId}
              shots={booth.shots}
              onShots={booth.setShots}
              onStart={booth.start}
              running={booth.running || booth.busy}
              ready={peer.localStream !== null && peer.remoteStream !== null}
            />
          )}

          {movie && (
            <MoviePanel
              film={media.film}
              playing={media.playing}
              myDurationSec={myDuration}
              videoError={videoError}
              fileError={fileError}
              picking={picking}
              onPick={() => setPicking(true)}
              onCancelPick={() => setPicking(false)}
              onLoadYouTube={(id) => {
                setVideoError(null);
                setFileError(null);
                setMovieFile(null);
                setPicking(false);
                media.load({ videoId: id, source: "youtube", durationSec: null });
              }}
              onOpenFile={(file) => {
                setFileError(null);
                setVideoError(null);
                setMovieFile(file);
                setPicking(false);
                // The name identifies the film to the other side; the length,
                // once the browser reports it, is what proves you opened the
                // same one. Neither is the file.
                media.load({
                  videoId: file.name,
                  source: "local",
                  durationSec: null,
                });
              }}
              volume={movieVolume}
              onVolume={setMovieVolume}
              onPlayPause={media.playPause}
              onResync={media.resync}
            />
          )}

          {karaoke && (
            <KaraokePanel
              videoId={media.videoId}
              playing={media.playing}
              audioMode={audio.mode}
              audioAuto={audio.auto}
              onChooseAudio={audio.choose}
              noisy={noisy}
              onNoisy={setNoisy}
              videoError={videoError}
              musicVolume={musicVolume}
              onMusicVolume={setMusicVolume}
              turn={turn}
              offsetMs={offsetMs}
              manual={manualOffset}
              onManual={setManualOffset}
              onOffsetMs={setOffsetMs}
              picking={picking}
              onPick={() => setPicking(true)}
              onCancelPick={() => setPicking(false)}
              onLoad={(id) => {
                // A new attempt starts clean; the last refusal was about the
                // last video, not this one.
                setVideoError(null);
                setPicking(false);
                media.load({ videoId: id, source: "youtube", durationSec: null });
              }}
              onPlayPause={media.playPause}
              onResync={media.resync}
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
