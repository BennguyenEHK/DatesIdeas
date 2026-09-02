"use client";

import { useId, useState, type FormEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import { youTubeId } from "@/lib/media/youtube";
import type { AudioMode } from "@/lib/media/micProfile";

/** The furthest the music can be pulled back, in milliseconds. */
export const MAX_OFFSET_MS = 1000;

/**
 * The karaoke control panel, living in the bottom letterbox bar under the
 * video. Headphones are gated first and exclusively: a synced song playing
 * into an open mic is one round trip away from becoming an echo, so nothing
 * else here is reachable until both of you have confirmed.
 */
export function KaraokePanel(props: {
  videoId: string | null;
  playing: boolean;
  videoError: number | null;
  audioMode: AudioMode | null;
  onChooseAudio: (mode: AudioMode) => void;
  noisy: boolean;
  onNoisy: (noisy: boolean) => void;
  onLoad: (videoId: string) => void;
  picking: boolean;
  onPick: () => void;
  onCancelPick: () => void;
  musicVolume: number;
  onMusicVolume: (percent: number) => void;
  matchSinging: boolean;
  onMatchSinging: (on: boolean) => void;
  offsetMs: number;
  onOffsetMs: (ms: number) => void;
  suggestedOffsetMs: number | null;
  onPlayPause: () => void;
  onResync: () => void;
}) {
  const {
    videoId,
    playing,
    videoError,
    audioMode,
    onChooseAudio,
    noisy,
    onNoisy,
    onLoad,
    picking,
    onPick,
    onCancelPick,
    musicVolume,
    onMusicVolume,
    matchSinging,
    onMatchSinging,
    offsetMs,
    onOffsetMs,
    suggestedOffsetMs,
    onPlayPause,
    onResync,
  } = props;

  // A song that failed to load is not a song to go back to, and neither is no
  // song at all — so in those two cases the picker is the only thing there is
  // and offering a way out of it would strand you on an empty panel.
  const nothingToReturnTo = videoId === null || videoError !== null;

  return (
    <section aria-label="Karaoke" className="w-full">
      {audioMode === null ? (
        <AudioGate onChoose={onChooseAudio} />
      ) : nothingToReturnTo || picking ? (
        <SongPicker
          onLoad={onLoad}
          videoError={videoError}
          onCancel={nothingToReturnTo ? null : onCancelPick}
        />
      ) : (
        <Transport
          playing={playing}
          audioMode={audioMode}
          onChooseAudio={onChooseAudio}
          noisy={noisy}
          onNoisy={onNoisy}
          musicVolume={musicVolume}
          onMusicVolume={onMusicVolume}
          matchSinging={matchSinging}
          onMatchSinging={onMatchSinging}
          offsetMs={offsetMs}
          onOffsetMs={onOffsetMs}
          suggestedOffsetMs={suggestedOffsetMs}
          onPlayPause={onPlayPause}
          onResync={onResync}
          onPick={onPick}
        />
      )}
    </section>
  );
}

/**
 * Asks where the song will be playing, because the answer decides how much of
 * the microphone processing can safely come off. A wrong answer is worse than
 * no answer, so both options are offered plainly rather than one being
 * presented as the correct one to click past.
 */
function AudioGate({ onChoose }: { onChoose: (mode: AudioMode) => void }) {
  return (
    <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 text-xs">
      <div className="flex min-w-0 flex-1 items-start gap-2 text-[var(--mist)]">
        <HeadphoneIcon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--lamp)]" />
        <p className="leading-relaxed">
          On speakers your mic picks the song back up and sends it on, arriving a beat
          behind the copy already playing. Cancelling that costs some of your voice with
          it, so headphones sound clearly better — speakers still work, and you can
          switch at any time.
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onChoose("headphones")}
          className="rounded-[2px] border border-[var(--lamp)]/45 px-4 py-1.5 tracking-wide text-[var(--lamp)] transition-colors hover:bg-[var(--lamp)]/10"
        >
          I&rsquo;m on headphones
        </button>
        <button
          type="button"
          onClick={() => onChoose("speakers")}
          className="rounded-[2px] border border-[var(--edge)] px-4 py-1.5 tracking-wide text-[var(--mist)] transition-colors hover:border-[var(--lamp)]/45 hover:text-[var(--cream)]"
        >
          I&rsquo;m on speakers
        </button>
      </div>
    </div>
  );
}

/**
 * Switches the answer mid-song, since putting headphones on is exactly the
 * thing someone does once they hear how the speakers sound.
 */
function AudioSwitch({
  audioMode,
  onChoose,
}: {
  audioMode: AudioMode;
  onChoose: (mode: AudioMode) => void;
}) {
  const other: AudioMode = audioMode === "headphones" ? "speakers" : "headphones";
  return (
    <button
      type="button"
      onClick={() => onChoose(other)}
      title={`Switch to ${other}`}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-[2px] px-2 py-1 tracking-wide text-[var(--mist)] underline decoration-dotted decoration-[var(--mist)]/40 underline-offset-4 transition-colors hover:text-[var(--cream)]"
    >
      <HeadphoneIcon aria-hidden className="h-3.5 w-3.5" />
      {audioMode === "headphones" ? "Headphones" : "Speakers"}
    </button>
  );
}

/**
 * Whether the room is loud, which is a separate question from where the song
 * is playing and cannot be folded into it.
 *
 * Singing normally wants every microphone process off. In a loud room that is
 * the wrong call: with noise suppression off, echo cancellation has to pick a
 * voice out of a room full of competing sound, cannot do it cleanly, and
 * clamps down — which is heard as a thin, gated, "filtered" voice.
 */
function NoisyToggle({
  noisy,
  onNoisy,
}: {
  noisy: boolean;
  onNoisy: (noisy: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onNoisy(!noisy)}
      title={noisy ? "Switch to quiet room" : "Switch to noisy room"}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-[2px] px-2 py-1 tracking-wide text-[var(--mist)] underline decoration-dotted decoration-[var(--mist)]/40 underline-offset-4 transition-colors hover:text-[var(--cream)]"
    >
      {noisy ? "Noisy room" : "Quiet room"}
    </button>
  );
}

/**
 * What YouTube's error numbers actually mean, in words that suggest a next
 * step. 101 and 150 are the common one and the useful one to explain: plenty
 * of official music uploads forbid embedding, and a karaoke channel's version
 * of the same song almost always allows it.
 */
function videoErrorMessage(code: number): string {
  switch (code) {
    case 101:
    case 150:
      return "The uploader doesn't allow this video to play outside YouTube. Search the song plus “karaoke” — those versions almost always work.";
    case 100:
      return "That video is gone — removed, or set to private.";
    case 5:
      return "This browser couldn't play that one. Try a different upload.";
    default:
      return "That video wouldn't play here. Try a different link.";
  }
}

function SongPicker({
  onLoad,
  videoError,
  onCancel,
}: {
  onLoad: (videoId: string) => void;
  videoError: number | null;
  /** Null when there is no song behind this to go back to. */
  onCancel: (() => void) | null;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);
  const inputId = useId();
  const helperId = useId();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = youTubeId(value);
    if (id === null) {
      setError(true);
      return;
    }
    setError(false);
    onLoad(id);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 text-xs"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span aria-hidden className="shrink-0 text-base">
          🎤
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
            if (error) setError(false);
          }}
          placeholder="Paste a YouTube link"
          aria-invalid={error}
          aria-describedby={helperId}
          className={`min-w-0 flex-1 rounded-[2px] border bg-[rgba(8,11,28,0.6)] px-3 py-1.5 text-[var(--cream)] placeholder:text-[var(--mist)]/35 focus:outline-none ${
            error
              ? "border-[var(--neon)]/70 focus:border-[var(--neon)]"
              : "border-[var(--edge)] focus:border-[var(--lamp)]/50"
          }`}
        />
      </div>

      <button
        type="submit"
        className="shrink-0 rounded-[2px] border border-[var(--lamp)]/45 px-4 py-1.5 tracking-wide text-[var(--lamp)] transition-colors hover:bg-[var(--lamp)]/10"
      >
        Load song
      </button>

      {/* type="button" matters: inside a form, a bare button submits, so
          cancelling would try to load whatever half-typed text was there. */}
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close and keep the current song"
          className="shrink-0 rounded-[2px] px-2 py-1.5 text-base leading-none text-[var(--mist)] transition-colors hover:text-[var(--cream)]"
        >
          ✕
        </button>
      )}

      {/* Same slot carries the helper copy or the error, so the row's
          height does not change between the two — only role="alert" swaps
          in, so the error is announced without the helper text being
          re-announced on every mount. */}
      <div id={helperId} className="w-full basis-full text-[0.65rem]">
        {error ? (
          <p role="alert" className="text-[var(--cream)]">
            <span aria-hidden className="mr-1 text-[var(--neon)]">
              ●
            </span>
            That doesn&rsquo;t look like a YouTube link — try pasting it again.
          </p>
        ) : videoError !== null ? (
          // YouTube refused the video after it loaded, which is a different
          // failure from a bad link and needs a different suggestion.
          <p role="alert" className="text-[var(--cream)]">
            <span aria-hidden className="mr-1 text-[var(--neon)]">
              ●
            </span>
            {videoErrorMessage(videoError)}
          </p>
        ) : (
          <p className="text-[var(--mist)]">A karaoke or lyrics video works best.</p>
        )}
      </div>
    </form>
  );
}

/**
 * The music level, and only this side's.
 *
 * Not part of the shared playback state on purpose: the song is streamed by
 * each side rather than sent between them, so loudness can differ while the
 * position stays identical. At zero the music is silent here and still
 * running — which is a real way to use it, listening to nothing but the other
 * person while both players stay on the same beat.
 */
function MusicVolume({
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
        Music
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

/**
 * Pulls this side's music back in time until the other person's voice lands on
 * the beat.
 *
 * Their voice spends a couple of hundred milliseconds crossing the internet
 * while your song carries on without it, so they always sound like they are
 * dragging — even though they are singing perfectly to their own copy.
 * Rewinding your music by that same amount lines the two up.
 *
 * It can only ever be right in one direction at a time. Delaying your music
 * means you are now singing behind your own copy, so your voice reaches them
 * twice as late as before. That is not a bug to be fixed; it is the distance
 * between two countries, and it is why this is a switch you flip while you are
 * listening rather than a setting you leave on.
 */
function MatchSinging({
  on,
  onToggle,
  offsetMs,
  onOffsetMs,
  suggestedMs,
}: {
  on: boolean;
  onToggle: (on: boolean) => void;
  offsetMs: number;
  onOffsetMs: (ms: number) => void;
  suggestedMs: number | null;
}) {
  const id = useId();
  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        onClick={() => onToggle(!on)}
        aria-pressed={on}
        title={
          suggestedMs === null
            ? "Delay your music so their singing lands on the beat"
            : `Measured delay on this connection: about ${suggestedMs}ms`
        }
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-[2px] border px-2.5 py-1 tracking-wide transition-colors ${
          on
            ? "border-[var(--lamp)]/60 bg-[var(--lamp)]/10 text-[var(--lamp)]"
            : "border-[var(--edge)] text-[var(--mist)] hover:border-[var(--lamp)]/45 hover:text-[var(--cream)]"
        }`}
      >
        Match their singing
      </button>

      {on && (
        <>
          <label htmlFor={id} className="sr-only">
            How far to delay your music
          </label>
          <input
            id={id}
            type="range"
            min={0}
            max={MAX_OFFSET_MS}
            step={20}
            value={offsetMs}
            onChange={(e) => onOffsetMs(Number(e.target.value))}
            aria-valuetext={`${offsetMs} milliseconds behind`}
            className="h-1 w-20 cursor-pointer appearance-none rounded-full bg-[var(--edge)] accent-[var(--lamp)]"
          />
          <span className="w-12 tabular-nums text-[var(--mist)]">{offsetMs}ms</span>
        </>
      )}
    </div>
  );
}

function Transport({
  playing,
  audioMode,
  onChooseAudio,
  noisy,
  onNoisy,
  musicVolume,
  onMusicVolume,
  matchSinging,
  onMatchSinging,
  offsetMs,
  onOffsetMs,
  suggestedOffsetMs,
  onPlayPause,
  onResync,
  onPick,
}: {
  playing: boolean;
  audioMode: AudioMode;
  onChooseAudio: (mode: AudioMode) => void;
  noisy: boolean;
  onNoisy: (noisy: boolean) => void;
  musicVolume: number;
  onMusicVolume: (percent: number) => void;
  matchSinging: boolean;
  onMatchSinging: (on: boolean) => void;
  offsetMs: number;
  onOffsetMs: (ms: number) => void;
  suggestedOffsetMs: number | null;
  onPlayPause: () => void;
  onResync: () => void;
  onPick: () => void;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 text-xs">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <span aria-hidden className="shrink-0 text-base">
          🎤
        </span>

        <button
          type="button"
          onClick={onPlayPause}
          aria-label={playing ? "Pause the song" : "Play the song"}
          className="relative inline-flex shrink-0 items-center rounded-[2px] border border-[var(--lamp)]/45 px-4 py-1.5 tracking-wide text-[var(--lamp)] transition-colors hover:bg-[var(--lamp)]/10"
        >
          {/* The one moment this panel is built around: the room is
              mid-song. Reuses ActivityBar's lit-bulb glow rather than
              inventing a second motif for the same idea. */}
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

        {/* Opens the picker over the song rather than stopping it. Browsing
            for the next track used to clear the video for both of you, which
            cut the other person off mid-verse. */}
        <button
          type="button"
          onClick={onPick}
          className="shrink-0 rounded-[2px] px-2 py-1.5 text-[var(--mist)] transition-colors hover:text-[var(--cream)]"
        >
          Change song
        </button>

        <MusicVolume value={musicVolume} onChange={onMusicVolume} />

        <MatchSinging
          on={matchSinging}
          onToggle={onMatchSinging}
          offsetMs={offsetMs}
          onOffsetMs={onOffsetMs}
          suggestedMs={suggestedOffsetMs}
        />

        <AudioSwitch audioMode={audioMode} onChoose={onChooseAudio} />

        <NoisyToggle noisy={noisy} onNoisy={onNoisy} />
      </div>

      <p className="w-full basis-full text-[0.65rem] text-[var(--mist)]">
        {matchSinging ? (
          <>
            Your music is running {offsetMs}ms late so their voice lands on the beat.
            Turn this off when it&rsquo;s your turn to sing — it can only be right for
            one of you at a time.
          </>
        ) : (
          <>
            Resync pulls you both back together if an ad or a stall knocked the song out
            of step.
            {audioMode === "speakers"
              ? " On speakers, keep the volume moderate — the louder it is, the more of it your mic sends back."
              : null}
          </>
        )}
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

function HeadphoneIcon({ className }: { className: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
    >
      <path d="M2.5 9.5v-2a5.5 5.5 0 0 1 11 0v2" strokeLinecap="round" />
      <rect x="1.5" y="9" width="3" height="4.5" rx="1" />
      <rect x="11.5" y="9" width="3" height="4.5" rx="1" />
    </svg>
  );
}
