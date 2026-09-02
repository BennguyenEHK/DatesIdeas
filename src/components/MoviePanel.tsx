"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import { youTubeId } from "@/lib/media/youtube";
import { filmsMatch, type Film } from "@/lib/media/sync";
import { formatDuration } from "@/lib/history/aggregate";

/**
 * The movie controls, in the bottom letterbox bar under the screen.
 *
 * Karaoke's sibling, and deliberately shorter than it. Karaoke has to ask
 * where the song is playing before anything else, because singing into an open
 * microphone over loudspeakers becomes an echo. Watching a film is ordinary
 * talking with something on in the background, so the ordinary microphone
 * settings are already right and there is nothing to ask.
 */
export function MoviePanel(props: {
  film: Film;
  playing: boolean;
  /** This side's own file, which is the only length we can measure directly. */
  myDurationSec: number | null;
  videoError: number | null;
  fileError: string | null;
  picking: boolean;
  onPick: () => void;
  onCancelPick: () => void;
  onLoadYouTube: (videoId: string) => void;
  onOpenFile: (file: File) => void;
  volume: number;
  onVolume: (percent: number) => void;
  onPlayPause: () => void;
  onResync: () => void;
}) {
  const {
    film,
    playing,
    myDurationSec,
    videoError,
    fileError,
    picking,
    onPick,
    onCancelPick,
    onLoadYouTube,
    onOpenFile,
    volume,
    onVolume,
    onPlayPause,
    onResync,
  } = props;

  const nothingToReturnTo =
    film.videoId === null || videoError !== null || fileError !== null;

  return (
    <section aria-label="Movie" className="w-full">
      <Mismatch film={film} myDurationSec={myDurationSec} />
      {nothingToReturnTo || picking ? (
        <FilmPicker
          onLoadYouTube={onLoadYouTube}
          onOpenFile={onOpenFile}
          videoError={videoError}
          fileError={fileError}
          onCancel={nothingToReturnTo ? null : onCancelPick}
        />
      ) : (
        <Transport
          film={film}
          playing={playing}
          volume={volume}
          onVolume={onVolume}
          onPlayPause={onPlayPause}
          onResync={onResync}
          onPick={onPick}
        />
      )}
    </section>
  );
}

/**
 * Says when the two of you opened different files.
 *
 * The one way a local film can go wrong. Both players would sit obediently at
 * the same second of two different films, and nothing else in the app would
 * ever mention it — you would just spend an evening quietly out of step,
 * wondering why her reactions never matched the scene.
 */
function Mismatch({
  film,
  myDurationSec,
}: {
  film: Film;
  myDurationSec: number | null;
}) {
  if (film.source !== "local" || myDurationSec === null) return null;
  const mine: Film = { videoId: null, source: "local", durationSec: myDurationSec };
  if (filmsMatch(mine, film)) return null;

  return (
    <p
      role="alert"
      className="mb-2 flex flex-wrap items-baseline gap-x-2 text-[0.7rem] text-[var(--cream)]"
    >
      <span aria-hidden className="text-[var(--neon)]">
        ●
      </span>
      These look like different files — yours runs{" "}
      <strong className="font-normal text-[var(--lamp)]">
        {formatDuration(myDurationSec * 1000)}
      </strong>
      , theirs{" "}
      <strong className="font-normal text-[var(--lamp)]">
        {formatDuration((film.durationSec ?? 0) * 1000)}
      </strong>
      . The position will stay in step, but the film will not.
    </p>
  );
}

function FilmPicker({
  onLoadYouTube,
  onOpenFile,
  videoError,
  fileError,
  onCancel,
}: {
  onLoadYouTube: (videoId: string) => void;
  onOpenFile: (file: File) => void;
  videoError: number | null;
  fileError: string | null;
  onCancel: (() => void) | null;
}) {
  const [value, setValue] = useState("");
  const [linkError, setLinkError] = useState(false);
  const inputId = useId();
  const helperId = useId();
  const fileInput = useRef<HTMLInputElement>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = youTubeId(value);
    if (id === null) {
      setLinkError(true);
      return;
    }
    setLinkError(false);
    onLoadYouTube(id);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 text-xs"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span aria-hidden className="shrink-0 text-base">
          🎬
        </span>
        <label htmlFor={inputId} className="sr-only">
          YouTube link
        </label>
        <input
          id={inputId}
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (linkError) setLinkError(false);
          }}
          placeholder="Paste a YouTube link"
          aria-invalid={linkError}
          aria-describedby={helperId}
          className={`min-w-0 flex-1 rounded-[2px] border bg-[rgba(8,11,28,0.6)] px-3 py-1.5 text-[var(--cream)] placeholder:text-[var(--mist)]/35 focus:outline-none ${
            linkError
              ? "border-[var(--neon)]/70 focus:border-[var(--neon)]"
              : "border-[var(--edge)] focus:border-[var(--lamp)]/50"
          }`}
        />
      </div>

      <button
        type="submit"
        className="shrink-0 rounded-[2px] border border-[var(--lamp)]/45 px-4 py-1.5 tracking-wide text-[var(--lamp)] transition-colors hover:bg-[var(--lamp)]/10"
      >
        Play link
      </button>

      <span aria-hidden className="shrink-0 text-[0.65rem] uppercase tracking-[0.3em] text-[var(--mist)]/60">
        or
      </span>

      {/* The input itself is hidden because the browser's own file button
          cannot be styled and reads as a form control from another site. */}
      <input
        ref={fileInput}
        type="file"
        accept="video/*"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onOpenFile(file);
          // Cleared so choosing the same file twice still fires a change.
          event.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => fileInput.current?.click()}
        className="shrink-0 rounded-[2px] border border-[var(--edge)] px-4 py-1.5 tracking-wide text-[var(--mist)] transition-colors hover:border-[var(--lamp)]/45 hover:text-[var(--cream)]"
      >
        Open a file
      </button>

      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close and keep the current film"
          className="shrink-0 rounded-[2px] px-2 py-1.5 text-base leading-none text-[var(--mist)] transition-colors hover:text-[var(--cream)]"
        >
          ✕
        </button>
      )}

      <div id={helperId} className="w-full basis-full text-[0.65rem]">
        {linkError ? (
          <p role="alert" className="text-[var(--cream)]">
            <span aria-hidden className="mr-1 text-[var(--neon)]">
              ●
            </span>
            That doesn&rsquo;t look like a YouTube link — try pasting it again.
          </p>
        ) : fileError ? (
          <p role="alert" className="text-[var(--cream)]">
            <span aria-hidden className="mr-1 text-[var(--neon)]">
              ●
            </span>
            {fileError}
          </p>
        ) : videoError !== null ? (
          <p role="alert" className="text-[var(--cream)]">
            <span aria-hidden className="mr-1 text-[var(--neon)]">
              ●
            </span>
            That video wouldn&rsquo;t play here. Plenty of uploads forbid playing
            outside YouTube — try another one.
          </p>
        ) : (
          <p className="text-[var(--mist)]">
            A film from your computer stays on your computer — only where you are
            in it is shared, so you&rsquo;ll each need your own copy.
          </p>
        )}
      </div>
    </form>
  );
}

function Volume({
  value,
  onChange,
}: {
  value: number;
  onChange: (percent: number) => void;
}) {
  const id = useId();
  return (
    <div className="flex shrink-0 items-center gap-2">
      <label htmlFor={id} className="whitespace-nowrap text-[var(--mist)]">
        Volume
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-valuetext={value === 0 ? "Muted here" : `${value} percent`}
        className="h-1 w-24 cursor-pointer appearance-none rounded-full bg-[var(--edge)] accent-[var(--lamp)]"
      />
      <span className="w-8 tabular-nums text-[var(--mist)]">
        {value === 0 ? "off" : `${value}%`}
      </span>
    </div>
  );
}

function Transport({
  film,
  playing,
  volume,
  onVolume,
  onPlayPause,
  onResync,
  onPick,
}: {
  film: Film;
  playing: boolean;
  volume: number;
  onVolume: (percent: number) => void;
  onPlayPause: () => void;
  onResync: () => void;
  onPick: () => void;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 text-xs">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <span aria-hidden className="shrink-0 text-base">
          🎬
        </span>

        <button
          type="button"
          onClick={onPlayPause}
          aria-label={playing ? "Pause the film" : "Play the film"}
          className="relative inline-flex shrink-0 items-center rounded-[2px] border border-[var(--lamp)]/45 px-4 py-1.5 tracking-wide text-[var(--lamp)] transition-colors hover:bg-[var(--lamp)]/10"
        >
          {playing ? (
            <motion.span
              aria-hidden
              className="pointer-events-none absolute inset-[-6px] rounded-[4px]"
              style={{
                background:
                  "radial-gradient(circle, rgba(242,194,48,0.55), transparent 70%)",
                filter: "blur(6px)",
              }}
              animate={reduceMotion ? { opacity: 0.8 } : { opacity: [0.5, 1, 0.5] }}
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : { duration: 2.4, repeat: Infinity, ease: "easeInOut" }
              }
            />
          ) : null}
          <span className="relative z-10 inline-flex items-center gap-2">
            {playing ? <PauseIcon /> : <PlayIcon />}
            {playing ? "Pause" : "Play"}
          </span>
        </button>

        <button
          type="button"
          onClick={onResync}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-[2px] px-2 py-1.5 text-[var(--mist)] transition-colors hover:text-[var(--cream)]"
        >
          <ResyncIcon />
          Resync
        </button>

        <button
          type="button"
          onClick={onPick}
          className="shrink-0 rounded-[2px] px-2 py-1.5 text-[var(--mist)] transition-colors hover:text-[var(--cream)]"
        >
          Change film
        </button>

        <Volume value={volume} onChange={onVolume} />

        {/* Which of the two routes this film came in by. Worth stating: it is
            what decides whether the other person needed their own copy. */}
        <span className="shrink-0 text-[0.65rem] uppercase tracking-[0.25em] text-[var(--mist)]/70">
          {film.source === "local" ? "Your file" : "YouTube"}
        </span>
      </div>

      <p className="w-full basis-full text-[0.65rem] text-[var(--mist)]">
        Resync pulls you both back together if an ad or a stall knocked the film out
        of step. Volume is yours alone — turning it down here leaves theirs where it
        was.
      </p>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="h-3 w-3 fill-current">
      <path d="M4 2.5v11l10-5.5z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="h-3 w-3 fill-current">
      <rect x="3.5" y="2.5" width="3" height="11" />
      <rect x="9.5" y="2.5" width="3" height="11" />
    </svg>
  );
}

function ResyncIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="h-3 w-3 fill-none stroke-current"
      strokeWidth={1.6}
    >
      <path d="M13 8A5 5 0 1 1 11.5 4.2" strokeLinecap="round" />
      <path d="M13 2.5V5.5H10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
