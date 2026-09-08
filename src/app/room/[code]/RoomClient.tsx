"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
import { KaraokePanel, type SongLanding } from "@/components/KaraokePanel";
import { RoomControls } from "@/components/RoomControls";
import { Blackout } from "@/components/Blackout";
import { useEnding } from "@/lib/room/useEnding";
import { useKaraokeTrack } from "@/lib/karaoke/useKaraokeTrack";
import { useKaraokeHelper } from "@/lib/karaoke/useKaraokeHelper";
import { useTrackTransfer, type ReceivedTrack } from "@/lib/karaoke/useTrackTransfer";
import { MoviePanel } from "@/components/MoviePanel";
import { ChatBubble } from "@/components/ChatBubble";
import { HouseLights } from "@/components/HouseLights";
import { LiveToggle } from "@/components/LiveToggle";
import { PerformerStage } from "@/components/PerformerStage";
import { addLine, type ChatLine } from "@/lib/ui/chatLog";
import { getIdentity } from "@/lib/history/identity";
import { playChime } from "@/lib/ui/chime";
import { LocalFilePlayer } from "@/components/LocalFilePlayer";
import { PhotoBoothStage } from "@/components/PhotoBoothStage";
import { PhotoBoothPanel } from "@/components/PhotoBoothPanel";
import { PhotoStrip } from "@/components/PhotoStrip";
import { useBooth } from "@/lib/photo/useBooth";
import { YouTubePlayer } from "@/components/YouTubePlayer";
import { useSyncedPlayback } from "@/lib/media/useSyncedPlayback";
import { useMicProfile } from "@/lib/media/useMicProfile";
import { describeMic } from "@/lib/media/micState";
import { describeLevel } from "@/lib/media/inputLevel";
import type { MicReport } from "@/lib/rtc/diagnostics";
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
import { stagePlayer, holdsCurrentSong, songLanding } from "@/lib/media/stagePlayer";
import { useVolumeDuck } from "@/lib/media/useVolumeDuck";
import { worthDucking } from "@/lib/media/duck";
import { uploadKeepsake, type KeepsakeKind } from "@/lib/photo/keepsake";
import { usePersistentToggle } from "@/lib/ui/usePersistentToggle";
import type { MemeId, PeerMessage } from "@/lib/rtc/protocol";

/**
 * The call page is framed as a widescreen film still: every piece of interface
 * lives in the letterbox bars above and below the stage, so decoration can
 * never creep onto the video itself.
 */
/**
 * How long to keep the transport locked after every byte has been handed over,
 * waiting for the other side to say the song arrived.
 *
 * Generous, because on a relayed connection the bytes go on draining long after
 * the sending loop has finished with them. Finite, because a peer on an older
 * build cannot answer at all, and a lock with no way out is worse than a song
 * that might start half a beat apart.
 */
const ACK_WAIT_MS = 120_000;

/**
 * How long a room stays locked for a song that was asked for and never came.
 *
 * This covers only the announcement, not the song: once the bytes start moving
 * the transfer announces its own size and takes over the waiting. What is being
 * bounded here is the helper's download, plus the round trip if the request has
 * to be handed to the other computer -- half a minute in the ordinary case.
 *
 * Bounded at all because a fetch can end in ways that send nothing back: the
 * other person closes the tab, their helper stops answering. Without this the
 * room would be locked out of its own transport for the rest of the evening.
 */
const LOAD_WAIT_MS = 120_000;

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
  // Same reaching-backwards trick: the transfer needs the peer's file channel,
  // so it cannot exist until after the handler that feeds it is written.
  const acceptTrack = useRef<((m: PeerMessage) => void) | null>(null);
  const serveTrack = useRef<((url: string, requestId: string) => void) | null>(null);
  const acceptTrackReady = useRef<((requestId: string) => void) | null>(null);
  // Reaching backwards like the handlers above it: the message arrives long
  // before the state it sets has been declared.
  const acceptTrackLoading = useRef<((requestId: string) => void) | null>(null);
  const clearTrackLoading = useRef<((requestId: string) => void) | null>(null);
  const [videoError, setVideoError] = useState<number | null>(null);
  // Local to this side, never sent. Starts low because the backing track burying
  // the other person's voice is the reported problem, and 70 was not enough.
  //
  // Both sides hear the same song from their own copy of the video, at whatever
  // volume they chose. The only thing crossing the link is the singing, and
  // since the singing microphone stopped using automatic gain control that
  // singing arrives about 14dB quieter than it used to -- measured, peak 0.50
  // down to peak 0.10. The music did not get quieter to match, so it took over.
  // Twenty-five is the level a duet actually sits on top of; the slider is
  // right there for anyone who wants the room louder.
  const [musicVolume, setMusicVolume] = useState(25);
  // Whether this room is loud. A separate question from where the song is
  // playing: in a noisy room the microphone processing that ruins singing is
  // the same processing keeping the singing audible at all.
  const [noisy, setNoisy] = useState(false);
  // What the other person last said about their own microphone and camera.
  // Assumed on until they say otherwise: a peer on a build that never sends
  // this should look like somebody whose devices are working, not like
  // somebody sitting in the dark.
  const [theirSwitches, setTheirSwitches] = useState({ mic: true, cam: true });
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
  // Reaching backwards like the handlers around them: both messages arrive long
  // before the state they land in has been declared.
  const acceptChat = useRef<((m: PeerMessage) => void) | null>(null);
  const acceptLive = useRef<((m: PeerMessage) => void) | null>(null);
  const acceptEnding = useRef<((m: PeerMessage) => void) | null>(null);
  const announceSwitches = useRef<(() => void) | null>(null);
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
      if (msg.t === "chat") {
        acceptChat.current?.(msg);
        return;
      }
      if (msg.t === "live") {
        acceptLive.current?.(msg);
        return;
      }
      if (msg.t === "presence") {
        setTheirSwitches({ mic: msg.mic, cam: msg.cam });
        return;
      }
      if (msg.t === "ending") {
        acceptEnding.current?.(msg);
        return;
      }
      if (msg.t === "hello") {
        // They have only just arrived, so they know nothing about the state of
        // this side's devices. Said once, on their arrival, rather than
        // repeated: nothing else here changes it without saying so.
        announceSwitches.current?.();
        return;
      }
      if (
        msg.t === "track-meta" ||
        msg.t === "track-done" ||
        msg.t === "track-error"
      ) {
        // Only a failure ends the announcement early. It deliberately does
        // NOT end on track-meta: the film id is broadcast from inside an async
        // callback and the announcement of the bytes is not, so the bytes can
        // be announced first -- and clearing here would put the previous song
        // back on the stage, with a live play button, for the moment in
        // between. The transfer outranks the announcement instead.
        if (msg.t === "track-error") clearTrackLoading.current?.(msg.requestId);
        acceptTrack.current?.(msg);
        return;
      }
      if (msg.t === "track-loading") {
        // They have asked for a song. Nothing has been fetched yet, let alone
        // sent -- but the song on this screen is already the wrong one, and the
        // transport is shared, so it must stop being touchable now rather than
        // half a minute from now when the first byte finally shows up.
        acceptTrackLoading.current?.(msg.requestId);
        return;
      }
      if (msg.t === "track-ready") {
        // Their browser has the song. This is the only way this side can know:
        // handing bytes to an open channel says nothing about when they land.
        acceptTrackReady.current?.(msg.requestId);
        return;
      }
      if (msg.t === "track-request") {
        // Only the side with a helper can answer this, and it answers by
        // fetching and then pushing the result back. The asking side never
        // learns which of the two machines did the work.
        serveTrack.current?.(msg.url, msg.requestId);
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

  const router = useRouter();
  /**
   * The end of the evening, counted down on the shared clock.
   *
   * The shared clock rather than this machine's: two computers disagree about
   * the time by however far they have drifted, and the two screens have to go
   * dark together or one person watches the other vanish early.
   */
  const ending = useEnding({
    now: () => peer.clock?.now() ?? Date.now(),
    send: peer.send,
    onFinished: () => router.push("/"),
  });
  useEffect(() => {
    acceptEnding.current = ending.accept;
  });

  // Said on every change, and again whenever they arrive. Silence and black
  // frames are what a disabled track transmits, and neither is distinguishable
  // from a connection that has broken.
  useEffect(() => {
    announceSwitches.current = () =>
      peer.send({ t: "presence", mic: peer.micOn, cam: peer.camOn });
  });
  // Depends on the two switches and nothing else. `peer` is a fresh object on
  // every render, so listing it here would put a presence message on the data
  // channel every time anything in this room changed -- which during a song is
  // several a second.
  useEffect(() => {
    announceSwitches.current?.();
  }, [peer.micOn, peer.camOn]);

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

  const track = useKaraokeTrack();
  /**
   * The song this side has sent that the other side has not confirmed holding.
   *
   * Null once they acknowledge it, or once waiting stops being honest. Only the
   * sender needs this: the receiver already knows perfectly well that its own
   * song has not arrived.
   */
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const ackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * A song that has been asked for and has not arrived, and whose machine is
   * fetching it.
   *
   * The helper spends twenty or thirty seconds downloading a video, and until
   * this existed not one byte crossed the connection in all that time. The
   * other person's browser therefore had no idea anything had been asked for:
   * it kept the previous song on the stage and a live play button over it, and
   * pressing that started one song here and a different one there.
   *
   * Whose machine is doing the work cannot be recovered later -- by the time
   * the stage has been forced to "waiting" it looks the same from both sides --
   * so it is recorded here, where it is still known.
   */
  const [loadingSong, setLoadingSong] = useState<{
    requestId: string;
    mine: boolean;
  } | null>(null);
  const loadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const beginLoading = useCallback((requestId: string, mine: boolean) => {
    if (loadTimer.current !== null) clearTimeout(loadTimer.current);
    setLoadingSong({ requestId, mine });
    loadTimer.current = setTimeout(() => {
      loadTimer.current = null;
      setLoadingSong(null);
    }, LOAD_WAIT_MS);
  }, []);

  /**
   * Ends the wait for one particular song.
   *
   * Matched on the request rather than clearing whatever is there, because a
   * failure belonging to an abandoned song would otherwise unlock the room in
   * the middle of the one that replaced it -- and the same id travels the whole
   * way round, including when the fetch is handed to the other computer.
   */
  const endLoading = useCallback((requestId: string) => {
    setLoadingSong((cur) => (cur === null || cur.requestId === requestId ? null : cur));
  }, []);

  // Cleared separately from the state above: a stale timer left running would
  // wipe the announcement of a song that arrived after it.
  useEffect(() => {
    if (loadingSong === null && loadTimer.current !== null) {
      clearTimeout(loadTimer.current);
      loadTimer.current = null;
    }
  }, [loadingSong]);
  // Read by the acknowledgement handler, which must not clear the timer
  // belonging to a DIFFERENT song just because a late ack for the previous one
  // turned up -- that would leave this locked with nothing left to unlock it.
  const sendingToRef = useRef<string | null>(null);
  /**
   * Whether the song being sung is a file this browser holds, rather than a
   * YouTube embed.
   *
   * It no longer picks between two kinds of player. A fetched track is now an
   * mp4 shown in the same <video> element a local film uses, so exactly one
   * player is ever mounted and `player` is always the right handle. What this
   * still answers is whether the pair of you can nudge the song's speed, which
   * only a file you hold allows.
   */
  const media = useSyncedPlayback(player, peer.clock, peer.send, offsetMs / 1000, precision);
  /**
   * Which player the stage should be showing, decided in one place.
   *
   * This used to be read off a flag meaning "this side holds the file", which
   * answers a different question -- whether the song's speed can be nudged --
   * and left the side WITHOUT the file falling through to the YouTube player.
   * The sync layer then handed that player the shared id, which for a fetched
   * track is the song's title, and the other person got "Video unavailable"
   * while the sender watched it play perfectly.
   */
  const stage = stagePlayer({
    activity: current,
    filmSource: media.film.source,
    // Karaoke asks WHICH song is held, not whether one is. `track.ready` stays
    // true from the previous song forever, so the side that had not yet
    // received a newly chosen one went on showing -- and playing -- the song
    // before it, while the sender watched the new one.
    hasFile:
      current === "karaoke"
        ? holdsCurrentSong({ ready: track.ready, id: track.id }, media.film.videoId)
        : movieFile !== null,
    // True while a song neither side is holding yet has been asked for. It
    // outranks the file above, which at that moment is still answering for the
    // song being replaced.
    songLoading: loadingSong !== null,
  });
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

  /**
   * Sends one keepsake away so a QR code has something to point at.
   *
   * The still is already sitting in memory as an object URL; the moving strip
   * is stitched only when asked for, because it costs about twelve seconds of
   * painting and most evenings nobody wants it.
   */
  const onUploadKeepsake = useCallback(
    async (kind: KeepsakeKind) => {
      let blob: Blob | null = null;
      if (kind === "clip") {
        blob = await booth.liveStrip();
      } else if (booth.stripUrl !== null) {
        blob = await fetch(booth.stripUrl)
          .then((r) => r.blob())
          .catch(() => null);
      }
      if (blob === null) return { ok: false, error: "there was nothing to send" };
      // The recorder picks its own format at runtime, so the blob is the only
      // thing that actually knows what this file is.
      return uploadKeepsake(blob, { room: code, kind, mimeType: blob.type });
    },
    [booth, code],
  );

  const karaoke = current === "karaoke";

  const onTrackMedia = useCallback(
    (file: File) => {
      // The same string that goes out as the film's id, so the two sides can
      // tell whether they are holding the same song rather than merely a song.
      void track.chooseMedia(file, null, file.name).then((seconds) => {
        if (seconds === null) return;
        // The last refusal was about the last song, not this one.
        setVideoError(null);
        setPicking(false);
        // The name identifies it loosely and the length identifies it properly:
        // for a track each side opened itself, the duration is the only way to
        // notice you are singing along to two different files.
        media.load({ videoId: file.name, source: "local", durationSec: seconds });
        media.reportDuration(seconds);
      });
    },
    [track, media],
  );

  const helper = useKaraokeHelper();

  /**
   * Takes a track this side now holds and makes it the song.
   *
   * The same path whether it was fetched here or arrived from the other side,
   * because by this point there is no difference: both are bytes in memory
   * waiting to be shown.
   *
   * The length is passed as a hint rather than measured again. The other side
   * already established it, and asking this browser to re-read it from the file
   * would risk the two of you disagreeing about how long the same song is.
   */
  const adoptTrack = useCallback(
    (arrived: ReceivedTrack) => {
      void track.chooseMedia(arrived.media, arrived.durationSec, arrived.title).then((seconds) => {
        if (seconds === null) return;
        // Whatever was announced has now happened, on whichever machine did it.
        endLoading(arrived.requestId);
        setVideoError(null);
        setPicking(false);
        media.load({
          videoId: arrived.title,
          source: "local",
          durationSec: seconds,
        });
        media.reportDuration(seconds);
      });
    },
    [track, media, endLoading],
  );

  const transfer = useTrackTransfer({
    sendMessage: peer.send,
    sendFileChunk: peer.sendFileChunk,
    fileChannelOpen: peer.fileChannelOpen,
    onFileChunk: peer.onFileChunk,
    onReceived: (arrived) => {
      adoptTrack(arrived);
      // Their play button is locked until this reaches them. Sent before the
      // file has been decoded rather than after: the bytes are what the other
      // side is waiting on, and this browser is now holding all of them.
      peer.send({ t: "track-ready", requestId: arrived.requestId });
    },
  });
  useEffect(() => {
    acceptTrack.current = transfer.handleMessage;
  });
  useEffect(() => {
    acceptTrackLoading.current = (requestId) => beginLoading(requestId, false);
    clearTrackLoading.current = endLoading;
  });
  useEffect(
    () => () => {
      if (loadTimer.current !== null) clearTimeout(loadTimer.current);
    },
    [],
  );
  useEffect(() => {
    sendingToRef.current = sendingTo;
    acceptTrackReady.current = (requestId) => {
      if (sendingToRef.current !== requestId) return;
      if (ackTimer.current !== null) {
        clearTimeout(ackTimer.current);
        ackTimer.current = null;
      }
      setSendingTo(null);
    };
  });
  useEffect(
    () => () => {
      if (ackTimer.current !== null) clearTimeout(ackTimer.current);
    },
    [],
  );

  /**
   * Fetches a pasted link and gives the result to both sides.
   *
   * `mayDelegate` is what stops the two of you bouncing the same failure back
   * and forth: a request that arrived from the peer is never handed back to
   * them, so a link nobody can fetch fails once and says so.
   */
  const fetchAndShare = useCallback(
    async (url: string, requestId: string, mayDelegate: boolean) => {
      const got = await helper.request(url);
      if (got === null) {
        // The other side may reach the helper when this one cannot -- one of
        // you is usually on the same network as the machine running it.
        if (mayDelegate) peer.send({ t: "track-request", url, requestId });
        else {
          peer.send({
            t: "track-error",
            requestId,
            message: "That song could not be fetched on either computer.",
          });
          // The error tells them; nothing tells this side, which announced
          // nothing and merely answered.
          endLoading(requestId);
        }
        return;
      }

      adoptTrack({
        media: new Blob([got.media], { type: got.contentType }),
        title: got.title,
        durationSec: got.durationSec,
        requestId,
      });
      // Locked from here until they say they have it. Playing a song only one
      // of you is holding is what started two different songs at once.
      setSendingTo(requestId);
      const outcome = await transfer.sendTrack({ requestId, ...got });
      if (outcome !== "sent") {
        setSendingTo(null);
        return;
      }
      // Handing every byte to the channel is not the same as their browser
      // having them, so the wait continues -- but not forever. A peer running
      // an older build has no way to answer, and a transport that quietly drops
      // the last of it would leave this locked for the evening.
      if (ackTimer.current !== null) clearTimeout(ackTimer.current);
      ackTimer.current = setTimeout(() => {
        ackTimer.current = null;
        setSendingTo(null);
      }, ACK_WAIT_MS);
    },
    [helper, peer, adoptTrack, transfer, endLoading],
  );

  useEffect(() => {
    serveTrack.current = (url, requestId) => {
      void fetchAndShare(url, requestId, false);
    };
  });

  const onFetchUrl = useCallback(
    (url: string) => {
      // Loose enough to tell two requests apart, which is all the id is for.
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      // Announced before anything is fetched, which is the whole point. The
      // download is the long part of loading a song, and it used to happen in
      // complete silence as far as the other person was concerned.
      peer.send({ t: "track-loading", requestId });
      beginLoading(requestId, true);
      void fetchAndShare(url, requestId, true);
    },
    [fetchAndShare, peer, beginLoading],
  );
  /**
   * How far along the wait is, or null when the share is genuinely unknown.
   *
   * Only the transfer between the two of you can be measured: it announces its
   * total up front. The helper's own download cannot, because yt-dlp is fetching
   * to a temporary file on the other machine and nothing here is told how big it
   * will be. Reporting 0% through those twenty-odd seconds would look like a
   * stall, so the bar is told to sweep instead.
   */
  const fetchPercent =
    transfer.incoming !== null && transfer.incoming.expectedBytes > 0
      ? Math.round(
          (transfer.incoming.receivedBytes / transfer.incoming.expectedBytes) * 100,
        )
      : null;

  /**
   * Which side, if either, is still waiting for the song's bytes.
   *
   * `stage === "waiting"` already means this browser does not hold the song the
   * room agreed on, which is the receiver's half. The sender's half cannot be
   * observed at all and has to be told: `sendingTo` holds until their browser
   * says it has the file.
   */
  const landing: SongLanding = songLanding({
    karaoke,
    stage,
    sendingTo,
    receiving: transfer.incoming !== null,
    loading: loadingSong === null ? null : loadingSong.mine ? "here" : "there",
  });

  const movie = current === "movie";
  const photobooth = current === "photobooth";

  // No karaoke exception. Pausing gestures there meant the status bar had a
  // state it could not name and reported a warm-up that would never finish --
  // and reactions are worth more mid-song than the CPU they cost.
  //
  // A booth sitting IS the exception, and for a different reason. Filming the
  // live photo paints both of you into a scene twenty-four times a second,
  // which is the same camera and the same main thread MediaPipe is using; run
  // together, the recording stutters and the countdown along with it. You are
  // posing for seven seconds, not reacting, so the trade is free. It comes
  // straight back the moment the sitting ends.
  const gesture = useGestureDetection(
    peer.localStream,
    onGesture,
    gesturesOn && !booth.running,
  );
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
  /**
   * The microphone the call is actually sending.
   *
   * This used to retune the existing one with applyConstraints. A whole
   * evening's telemetry showed why that never worked: every karaoke report came
   * back saying "Requested but refused: noiseSuppression, autoGainControl".
   * The browser decides a microphone's processing when the DEVICE IS OPENED and
   * never again, so the singing profile was asked for and quietly ignored, and
   * karaoke ran the processing built for speech -- which exists to remove a
   * sustained tone, and a held note is a sustained tone.
   *
   * So a fresh microphone is opened with the profile baked in and swapped onto
   * the sender. replaceTrack does that without renegotiating, so nothing drops.
   */
  /**
   * The microphone the peer connection itself opened, which this page does not
   * own and must never stop -- only lend out and take back.
   */
  const originalMic = useMemo(
    () => peer.localStream?.getAudioTracks()[0] ?? null,
    [peer.localStream],
  );

  const mic = useMicProfile({
    sender: peer.audioSender,
    mode: karaoke ? audio.mode : null,
    noisy,
    // What to hand the call back when the singing stops. Without it the hook
    // has nowhere to return the sender to, and its replacement microphone would
    // have to stay open for the rest of the evening.
    original: originalMic,
    // A freshly opened microphone always arrives enabled. The hook that opened
    // it is the only place that can put the switch back before it goes live.
    enabled: peer.micOn,
  });

  /**
   * What the level meter and the singing detector should listen to.
   *
   * The swapped track, once there is one: the original stream still holds the
   * microphone the peer connection opened, and measuring that would report on a
   * device no longer carrying the call.
   */
  const micStream = useMemo(() => {
    if (mic.track === null || typeof MediaStream !== "function") {
      return peer.localStream;
    }
    return new MediaStream([mic.track]);
  }, [mic.track, peer.localStream]);

  // Who is actually singing, which is the only thing that can decide whose
  // music moves. Both sides run this, and each tells the other.
  const singing = useSingingTurn({
    stream: micStream,
    send: peer.send,
    enabled: karaoke,
  });
  useEffect(() => {
    acceptSinging.current = singing.accept;
  });

  /**
   * The chat that runs alongside a film, and the stage that can be handed over.
   *
   * Both live here rather than inside their components because both are shared
   * facts about the room: a line of chat is only half a conversation until it
   * has crossed, and who holds the stage has to be the same answer on both
   * screens or two people end up performing at each other.
   */
  const [chat, setChat] = useState<readonly ChatLine[]>([]);
  const [performer, setPerformer] = useState<string | null>(null);
  // One context for the whole evening. Building a fresh one per message leaks
  // them, and browsers cap how many a page may hold.
  const chimeCtx = useRef<AudioContext | null>(null);
  const chime = useCallback((kind: "sent" | "received") => {
    try {
      const Ctor = globalThis.AudioContext;
      if (typeof Ctor !== "function") return;
      chimeCtx.current ??= new Ctor();
      playChime(chimeCtx.current, kind);
    } catch {
      // A room with no sound is still a room. Never let the chime break chat.
    }
  }, []);

  useEffect(() => {
    acceptChat.current = (m: PeerMessage) => {
      if (m.t !== "chat") return;
      setChat((log) => addLine(log, { id: m.id, text: m.text, at: m.at, mine: false }));
      chime("received");
    };
    acceptLive.current = (m: PeerMessage) => {
      if (m.t !== "live") return;
      setPerformer(m.performer);
    };
  }, [chime]);

  const onSendChat = useCallback(
    (text: string) => {
      const line: ChatLine = {
        // Sender-side id, so a message that crosses twice is still shown once.
        id: `${getIdentity()}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text,
        at: Date.now(),
        mine: true,
      };
      setChat((log) => addLine(log, line));
      peerRef.current?.send({ t: "chat", id: line.id, text: line.text, at: line.at });
      chime("sent");
    },
    [chime],
  );

  /**
   * Takes the stage, or gives it back.
   *
   * Scheduled on the shared clock like the activity and the card, so the two
   * screens rearrange themselves at the same moment rather than one of them
   * jumping a beat early.
   */
  const onLive = useCallback((live: boolean) => {
    const me = getIdentity();
    const next = live ? me : null;
    const clock = peerRef.current?.clock;
    const showAt = clock ? clock.now() + clock.leadTime() : Date.now();
    peerRef.current?.send({ t: "live", performer: next, showAt });
    if (clock) clock.scheduleAt(showAt, () => setPerformer(next));
    else setPerformer(next);
  }, []);

  /**
   * The microphone half of the pasteable report, built only when asked for.
   *
   * Null until karaoke has actually been opened, because before that nothing
   * has tuned the microphone and a row of "unknown" would imply we looked and
   * failed rather than that there was nothing yet to look at.
   */
  const micReport = useCallback((): MicReport | null => {
    if (mic.settings === null && mic.error === null) return null;
    const level = singing.readLevel();
    return {
      description: describeMic(mic.settings),
      unmet: mic.unmet,
      error: mic.error,
      level: describeLevel(level),
      dropouts: level.gates,
      voiceIsolation: mic.settings?.voiceIsolation ?? null,
    };
  }, [mic, singing]);

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

  /** The four devices in the room, as the two stages want them. */
  const switches = {
    you: { micOff: !peer.micOn, camOff: !peer.camOn },
    them: { micOff: !theirSwitches.mic, camOff: !theirSwitches.cam },
  };

  return (
    <>
      <Ambience />
      {/* The room dims when the film runs. Mounted only for the movie, because
          karaoke also has a `playing` transport and nobody wants the lights
          going down every time a song starts. */}
      {movie && <HouseLights playing={media.playing} />}
      <div className="flex min-h-screen flex-1 flex-col">
        {/* Top letterbox bar */}
        <header className="bar-top flex flex-wrap items-center justify-between gap-x-3 gap-y-2 bg-[var(--letterbox)] px-5 py-3">
          <Wordmark size="compact" />
          <ActivityBar current={current} onSelect={onSelectActivity} />
          {/* The room's own code and the room's own switches share the right
              hand end of the bar, and wrap together rather than apart: they are
              both about this room rather than about the evening in it. */}
          <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
            <CopyLink code={code} closesIn={closesIn} />
            <RoomControls
              micOn={peer.micOn}
              camOn={peer.camOn}
              onMic={peer.setMicOn}
              onCam={peer.setCamOn}
              endsInMs={ending.endsInMs}
              onEnd={ending.end}
              onStay={ending.stay}
            />
          </div>
        </header>

        {/* Who has the stage. Its own row under the bar rather than inside it:
            the bar is about the room, and this is about the next few minutes.
            Only while karaoke is open, and only once there is somebody to
            perform to. */}
        {karaoke && (
          <div className="flex justify-center px-4 pt-3 md:px-8">
            <LiveToggle
              live={performer !== null}
              enabled={peer.remoteStream !== null}
              onChange={onLive}
            />
          </div>
        )}

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
                filmCanvasRef={booth.filmCanvasRef}
              >
                <PhotoStrip
                  url={booth.stripUrl}
                  busy={booth.busy}
                  onSave={booth.save}
                  onUpload={onUploadKeepsake}
                  hasClip={booth.hasClip}
                  clipMimeType={booth.clipMimeType}
                  clipPending={booth.clipPending}
                  onDiscard={booth.discard}
                />
              </PhotoBoothStage>
            ) : karaoke && performer !== null ? (
              // One person plays and the other watches. A quarter of a second
              // of ocean makes a duet genuinely hard and a performance entirely
              // fine, which is why this shape exists at all.
              <PerformerStage
                performer={
                  performer === getIdentity() ? peer.localStream : peer.remoteStream
                }
                audience={
                  performer === getIdentity() ? peer.remoteStream : peer.localStream
                }
                performerLabel={performer === getIdentity() ? "You" : "Them"}
                audienceLabel={performer === getIdentity() ? "Them" : "You"}
                performerMemes={performer === getIdentity() ? mine.memes : theirs.memes}
                audienceMemes={performer === getIdentity() ? theirs.memes : mine.memes}
                mediaError={peer.mediaError}
                switches={switches}
              />
            ) : kind === "takeover" ? (
              <TakeoverStage
                local={peer.localStream}
                remote={peer.remoteStream}
                localMemes={mine.memes}
                remoteMemes={theirs.memes}
                mediaError={peer.mediaError}
                switches={switches}
              >
                {karaoke && stage === "local" ? (
                  // The karaoke video itself, in the same <video> element a
                  // local film uses. Its words are burned into the picture,
                  // which is why the scrolling lyrics that used to live here are
                  // gone -- and why this takes `setPlayer` like every other
                  // player, leaving exactly one handle for the sync layer.
                  <LocalFilePlayer
                    ref={setPlayer}
                    file={track.file}
                    onDuration={(seconds) => {
                      if (seconds !== null) media.reportDuration(seconds);
                    }}
                    // The position is stamped when play() is CALLED, and this
                    // element does not begin then -- it decodes and spins up,
                    // by a different amount on each machine. This is the first
                    // instant the resulting error exists to be measured, and
                    // without it nothing looked again for up to two seconds.
                    onStarted={media.started}
                    onError={setFileError}
                  />
                ) : stage === "waiting" ? (
                  // Deliberately no player at all. Mounting the YouTube one
                  // here is what showed the other person "Video unavailable":
                  // the sync layer would hand it the shared id, which for a
                  // fetched track is the song's title rather than a video.
                  <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-8 text-center">
                    <p className="text-sm text-[var(--mist)]">
                      Loading song…
                    </p>
                    <p className="text-xs text-[var(--mist)]/70">
                      {transfer.incoming !== null
                        ? fetchPercent === null
                          ? "Coming over from their computer."
                          : `Coming over from their computer — ${fetchPercent}%`
                        : loadingSong !== null
                          ? loadingSong.mine
                            ? "Downloading it on this computer."
                            : "They are downloading it on theirs."
                          : "Coming over from their computer."}
                    </p>
                  </div>
                ) : stage === "youtube" ? (
                  <YouTubePlayer
                    ref={setPlayer}
                    // The one thing that stops a film's own start-up delay
                    // being mistaken for drift and answered with a seek.
                    onStarted={media.started}
                    onError={setVideoError}
                  />
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
                    onStarted={media.started}
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
                switches={switches}
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
        <footer className="bar-bottom relative bg-[var(--letterbox)] px-5 py-3">
          <ConnectionStatus
            state={peer.state}
            path={peer.path}
            sending={peer.sending}
            rtt={peer.rtt}
            jitterMs={peer.jitterMs}
            audioJitterMs={peer.audioJitterMs}
            audioFormat={peer.audioFormat}
            turnDegraded={peer.turnDegraded}
            audioKbps={peer.audioKbps}
            gestureReady={gesture.ready}
            gestureError={gesture.error}
            gesturesOn={gesturesOn}
            onToggleGestures={setGesturesOn}
            onReport={() => peer.report(current, micReport())}
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

          {/* A whisper in a dark room. A bulb in the corner of the bar rather
              than a panel across it: the film is what the evening is for, and a
              conversation that is not happening should not be taking room from
              it. Only during a film -- the karaoke evening already has both of
              you singing at each other and does not need a second channel. */}
          {movie && (
            <ChatBubble
              lines={chat}
              onSend={onSendChat}
              ready={peer.state === "connected"}
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
                    track={{
                      ready: track.ready,
                      loading: track.loading,
                      error: track.error,
                      onMediaFile: onTrackMedia,
                    }}
                    helper={{
                      available: helper.available,
                      busy: helper.stage === "fetching" || transfer.incoming !== null,
                      note:
                        transfer.incoming !== null
                          ? `The song is arriving from their computer${
                              fetchPercent === null ? "" : ` — ${fetchPercent}%`
                            }`
                          : helper.stage === "fetching"
                            ? "The helper is downloading the video — this takes about half a minute."
                            : null,
                      percent: fetchPercent,
                      error: helper.error ?? transfer.error,
                      onFetchUrl,
                    }}
                    landing={landing}
                    // Only the receiving side can measure this. The sender is
                    // told when the song lands and nothing before it, so its
                    // bar sweeps rather than inventing a number.
                    landingPercent={landing === "here" ? fetchPercent : null}
                    picking={picking}
                    onPick={() => setPicking(true)}
                    onCancelPick={() => setPicking(false)}
                    onLoad={(id) => {
                      // Going back to a video gives up the speed control a file
                      // bought, so the two modes cannot both be current.
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

      {/* Last, and over everything: the set being switched off. It is laid on
          top rather than wrapped around the room because the countdown driving
          it lives in here -- unmounting the room to show black would take the
          timer with it, and the step that actually leaves would never run. */}
      <Blackout phase={ending.phase} />
    </>
  );
}
