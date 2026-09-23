"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ClipboardEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import { YouTubePlayer, type YouTubePlayerHandle } from "./YouTubePlayer";
import { UpNext } from "./UpNext";
import { Volume } from "./Volume";
import { parseYouTubeLink } from "@/lib/music/links";
import { currentTrack, type MusicState } from "@/lib/music/queue";
import { useVideoInfo } from "@/lib/music/titles";
import { YOUTUBE_ID_PATTERN, type MusicTrack } from "@/lib/rtc/protocol";

export interface MusicBarProps {
  queue: MusicState;
  onAdd: (videoIds: string[]) => void;
  onRemove: (at: number) => void;
  onJump: (at: number) => void;
  onNext: () => void;
  onPrevious: () => void;
  onPlayPause: () => void;
  onSeekBy: (deltaSeconds: number) => void;
  playing: boolean;
  /** Where the song is now. Read every frame, so it must be cheap. */
  positionSec: () => number;
  /** The song's length when the caller knows it; the player is asked otherwise. */
  durationSec: number | null;
  volume: number;
  onVolume: (percent: number) => void;
  /** Receives the bar's player, as the room's other players are received. */
  playerRef?: (handle: YouTubePlayerHandle | null) => void;
  onReady?: () => void;
  onStarted?: () => void;
  onEnded?: (videoId: string | null) => void;
  onError?: (code: number) => void;
  /** This person's identity, to tell their songs from the other person's. */
  identity: string;
  names: { you: string; them: string };
}

/** How long a player mounted only to read a playlist may take to be ready. */
const PLAYER_WAIT_MS = 10_000;

/** Whether this browser lets a page read the clipboard on a tap. */
function subscribeNothing() {
  return () => {};
}
function canReadClipboard() {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.readText === "function"
  );
}
function serverCannotReadClipboard() {
  return false;
}

function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * Tonight's music, in a slim strip under the top bar.
 *
 * Both of you hear the same song at the same moment and either of you can add
 * to the queue by pasting a link. Nothing here decides what plays: every
 * button reports an intention and the room turns it into shared state.
 *
 * The 64 px picture on the left is the YouTube player itself rather than a
 * thumbnail. It is the artwork, and a visible player is what YouTube's terms
 * ask for before it will play on every device. It never takes a click.
 */
export function MusicBar(props: MusicBarProps) {
  const {
    queue,
    onAdd,
    onRemove,
    onJump,
    onNext,
    onPrevious,
    onPlayPause,
    onSeekBy,
    playing,
    positionSec,
    durationSec,
    volume,
    onVolume,
    playerRef,
    onReady,
    onStarted,
    onEnded,
    onError,
    identity,
    names,
  } = props;

  const track = currentTrack(queue);
  const info = useVideoInfo(track?.videoId ?? null);
  const empty = queue.queue.length === 0;

  const [linkOpen, setLinkOpen] = useState(false);
  const [upNextOpen, setUpNextOpen] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkProblem, setLinkProblem] = useState<string | null>(null);
  // True while a pasted playlist is being read. The player is mounted for it
  // even before there is a queue, because it is the player that reads it.
  const [reading, setReading] = useState(false);
  const canPaste = useSyncExternalStore(
    subscribeNothing,
    canReadClipboard,
    serverCannotReadClipboard,
  );

  const fieldId = useId();
  const problemId = useId();
  const upNextId = useId();

  // The bar keeps its own hold on the player as well as handing it to the
  // room, because reading a playlist is the bar's job and not the room's.
  const handle = useRef<YouTubePlayerHandle | null>(null);
  const pendingList = useRef<string | null>(null);
  const setHandle = useCallback(
    (next: YouTubePlayerHandle | null) => {
      handle.current = next;
      playerRef?.(next);
    },
    [playerRef],
  );

  const readPlaylist = useCallback(
    (player: YouTubePlayerHandle, listId: string) => {
      pendingList.current = null;
      void player.expandPlaylist(listId).then((ids) => {
        const songs = ids.filter((id) => YOUTUBE_ID_PATTERN.test(id));
        setReading(false);
        if (songs.length === 0) {
          setLinkProblem("Couldn’t read that playlist");
          return;
        }
        onAdd(songs);
      });
    },
    [onAdd],
  );

  const handleReady = useCallback(() => {
    const listId = pendingList.current;
    if (listId !== null && handle.current) readPlaylist(handle.current, listId);
    onReady?.();
  }, [onReady, readPlaylist]);

  function addLink(raw: string) {
    const link = parseYouTubeLink(raw);
    if (link === null) {
      // The text stays, so a link that was nearly right can be fixed.
      setLinkProblem("That’s not a YouTube link");
      return;
    }
    setLinkProblem(null);
    setLinkText("");
    if (link.kind === "video") {
      onAdd([link.videoId]);
      return;
    }
    setReading(true);
    const player = handle.current;
    if (player?.isReady()) {
      readPlaylist(player, link.listId);
    } else {
      // No player yet, because the queue is empty. Mounting one is what
      // `reading` does; it picks the playlist up the moment it is ready.
      const listId = link.listId;
      pendingList.current = listId;
      // A player that never becomes ready -- YouTube blocked, or offline --
      // must not leave the bar saying it is reading forever.
      setTimeout(() => {
        if (pendingList.current !== listId) return;
        pendingList.current = null;
        setReading(false);
        setLinkProblem("Couldn’t read that playlist");
      }, PLAYER_WAIT_MS);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (linkText.trim() !== "") addLink(linkText);
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData("text");
    if (text.trim() === "") return;
    // Pasting is the request. Waiting for Enter as well would ask for the
    // same thing twice.
    event.preventDefault();
    setLinkText(text);
    addLink(text);
  }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      setLinkText(text);
      if (text.trim() !== "") addLink(text);
    } catch {
      // Refused, usually because permission was declined. The field is still
      // there to paste into by hand.
    }
  }

  // The progress line and the time are drawn straight onto the page each
  // frame. Held in state they would re-render the whole bar sixty times a
  // second for a line two pixels tall.
  const lineRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const positionRef = useRef(positionSec);
  const durationRef = useRef(durationSec);
  useEffect(() => {
    positionRef.current = positionSec;
    durationRef.current = durationSec;
  });
  useEffect(() => {
    let frame = requestAnimationFrame(function draw() {
      const at = positionRef.current();
      const length = durationRef.current ?? handle.current?.duration() ?? null;
      const share =
        length !== null && length > 0
          ? Math.min(1, Math.max(0, at / length))
          : 0;
      if (lineRef.current) lineRef.current.style.transform = `scaleX(${share})`;
      if (timeRef.current) {
        timeRef.current.textContent =
          length !== null ? `${clock(at)} / ${clock(length)}` : clock(at);
      }
      frame = requestAnimationFrame(draw);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const addedByName = (item: MusicTrack) =>
    item.addedBy === identity ? names.you : names.them;
  const index = queue.index;
  const upcoming =
    index === null ? queue.queue.length : queue.queue.length - index - 1;
  const title = track
    ? (track.title ?? info?.title ?? track.videoId)
    : "Nothing playing";
  const byline = track
    ? [info?.author, `added by ${addedByName(track)}`]
        .filter(Boolean)
        .join(" · ")
    : empty
      ? "Reading the playlist…"
      : `${queue.queue.length} ${queue.queue.length === 1 ? "song" : "songs"} waiting`;

  const linkButton = (
    <button
      type="button"
      onClick={() => setLinkOpen((open) => !open)}
      aria-expanded={linkOpen}
      aria-controls={fieldId}
      className="shrink-0 rounded-[2px] border border-[var(--edge)] px-3 py-1 tracking-wide text-[var(--mist)] transition-colors hover:text-[var(--cream)] motion-reduce:transition-none"
    >
      + link
    </button>
  );

  return (
    <section
      aria-label="Music"
      className="@container relative w-full border-b border-[var(--edge)] bg-[var(--letterbox)] font-sans text-xs text-[var(--mist)]"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 @min-[40rem]:flex-nowrap">
        {empty && !reading ? (
          <>
            <p className="min-w-0 flex-1 truncate">
              Paste a YouTube link to play music for both of you
            </p>
            {linkButton}
          </>
        ) : (
          <>
            <div className="flex w-full min-w-0 items-center gap-3 @min-[40rem]:w-auto @min-[40rem]:flex-1">
              <div className="pointer-events-none aspect-video w-16 shrink-0 overflow-hidden rounded-[2px] bg-[var(--dusk)]">
                <YouTubePlayer
                  ref={setHandle}
                  onReady={handleReady}
                  onStarted={onStarted}
                  onEnded={onEnded}
                  onError={onError}
                />
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-sm text-[var(--cream)]">
                  {title}
                </p>
                <p className="flex gap-2 text-[0.65rem]">
                  <span className="min-w-0 flex-1 truncate">{byline}</span>
                  <span ref={timeRef} className="shrink-0 tabular-nums" />
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-0.5">
                <IconButton
                  label="Previous song"
                  onClick={onPrevious}
                  disabled={index === null || index === 0}
                >
                  <PreviousIcon />
                </IconButton>
                <IconButton
                  label="Back 10 seconds"
                  onClick={() => onSeekBy(-10)}
                  disabled={track === null}
                >
                  <SkipIcon back />
                </IconButton>
                <IconButton
                  label={playing ? "Pause music" : "Play music"}
                  onClick={onPlayPause}
                >
                  {playing ? <PauseIcon /> : <PlayIcon />}
                </IconButton>
                <IconButton
                  label="Forward 10 seconds"
                  onClick={() => onSeekBy(10)}
                  disabled={track === null}
                >
                  <SkipIcon />
                </IconButton>
                <IconButton
                  label="Next song"
                  onClick={onNext}
                  disabled={index === null || index >= queue.queue.length - 1}
                >
                  <NextIcon />
                </IconButton>
              </div>
            </div>

            <div className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-2 @min-[40rem]:w-auto @min-[40rem]:flex-nowrap @min-[40rem]:justify-end">
              <Volume value={volume} onChange={onVolume} />
              <button
                type="button"
                onClick={() => setUpNextOpen((open) => !open)}
                aria-expanded={upNextOpen}
                aria-controls={upNextId}
                className="inline-flex shrink-0 items-center gap-1 rounded-[2px] px-2 py-1 text-[var(--mist)] transition-colors hover:text-[var(--cream)] motion-reduce:transition-none"
              >
                <span aria-hidden>{upNextOpen ? "⌃" : "⌄"}</span>
                Up next <span className="tabular-nums">{upcoming}</span>
              </button>
              {linkButton}
            </div>
          </>
        )}
      </div>

      {linkOpen ? (
        <form
          onSubmit={handleSubmit}
          className="flex flex-wrap items-center gap-2 px-3 pb-2"
        >
          <label htmlFor={fieldId} className="sr-only">
            YouTube link
          </label>
          <input
            id={fieldId}
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={linkText}
            onChange={(event) => {
              setLinkText(event.target.value);
              if (linkProblem) setLinkProblem(null);
            }}
            onPaste={handlePaste}
            placeholder="Paste a YouTube link"
            aria-invalid={linkProblem !== null}
            aria-describedby={problemId}
            className={`min-w-0 flex-1 rounded-[2px] border bg-[var(--dusk)] px-3 py-1.5 text-[var(--cream)] placeholder:text-[var(--mist)]/50 focus:outline-none ${
              linkProblem
                ? "border-[var(--neon)]/70 focus:border-[var(--neon)]"
                : "border-[var(--edge)] focus:border-[var(--cream)]/40"
            }`}
          />
          {canPaste ? (
            <button
              type="button"
              onClick={() => void pasteFromClipboard()}
              className="shrink-0 rounded-[2px] border border-[var(--edge)] px-3 py-1.5 text-[var(--mist)] transition-colors hover:text-[var(--cream)] motion-reduce:transition-none"
            >
              Paste
            </button>
          ) : null}
          <div id={problemId} className="w-full basis-full text-[0.65rem]">
            {linkProblem ? (
              <p role="alert" className="text-[var(--cream)]">
                {linkProblem}
              </p>
            ) : reading ? (
              <p aria-live="polite">Reading the playlist&hellip;</p>
            ) : null}
          </div>
        </form>
      ) : null}

      {upNextOpen && !empty ? (
        <UpNext
          id={upNextId}
          queue={queue.queue}
          index={index}
          addedByName={addedByName}
          onJump={onJump}
          onRemove={onRemove}
        />
      ) : null}

      {/* The only accent in the bar. Filled by the frame loop above; it is
          never animated otherwise, so reduced motion changes nothing here. */}
      <div
        ref={lineRef}
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-0 h-[2px] w-full origin-left scale-x-0 bg-[var(--lamp)]"
      />
    </section>
  );
}

function IconButton({
  label,
  onClick,
  disabled = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-7 w-7 items-center justify-center rounded-[2px] text-[var(--mist)] transition-colors hover:text-[var(--cream)] disabled:cursor-not-allowed disabled:text-[var(--mist)]/35 motion-reduce:transition-none"
    >
      {children}
    </button>
  );
}

function PlayIcon() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-current">
      <path d="M4 2.5v11l10-5.5z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-current">
      <rect x="3.5" y="2.5" width="3" height="11" />
      <rect x="9.5" y="2.5" width="3" height="11" />
    </svg>
  );
}

function PreviousIcon() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="h-3 w-3 fill-current">
      <rect x="2.5" y="3" width="2" height="10" />
      <path d="M13.5 3v10L5.5 8z" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="h-3 w-3 fill-current">
      <rect x="11.5" y="3" width="2" height="10" />
      <path d="M2.5 3v10l8-5z" />
    </svg>
  );
}

/**
 * A circular arrow with a small 10, pointing back or forward.
 *
 * Two drawings rather than one flipped, because flipping would mirror the 10.
 */
function SkipIcon({ back = false }: { back?: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 fill-none stroke-current"
      strokeWidth={1.4}
    >
      {back ? (
        <>
          <path d="M3.5 8A4.5 4.5 0 1 0 5.2 4.5" strokeLinecap="round" />
          <path
            d="M3.5 2.8V5.3H6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : (
        <>
          <path d="M12.5 8A4.5 4.5 0 1 1 10.8 4.5" strokeLinecap="round" />
          <path
            d="M12.5 2.8V5.3H10"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
      <text
        x="8"
        y="10"
        textAnchor="middle"
        fontSize="5"
        className="fill-current stroke-none"
      >
        10
      </text>
    </svg>
  );
}
