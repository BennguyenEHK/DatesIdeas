"use client";

import { useId, useState, type FormEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import { youTubeId } from "@/lib/media/youtube";
import type { AudioMode } from "@/lib/media/micProfile";
import { MAX_OFFSET_MS, type SingingTurn } from "@/lib/media/singerTurn";

export { MAX_OFFSET_MS };

/**
 * Singing to a track you own rather than to a video.
 *
 * The file never leaves the machine it was picked on, which is the same
 * arrangement a local film already has: only the position crosses the
 * connection, so each side opens its own copy. That is also why the length
 * matters — it is the only way to notice the two of you opened different files.
 */
export interface TrackChoice {
  ready: boolean;
  loading: boolean;
  hasLyrics: boolean;
  error: string | null;
  onAudioFile: (file: File) => void;
  onLyricsFile: (file: File) => void;
}

/**
 * The karaoke control panel, living in the bottom letterbox bar under the
 * video. The transport stays available before a song is loaded, so choosing a
 * song remains an action inside the room rather than an entry gate.
 */
export function KaraokePanel(props: {
  videoId: string | null;
  playing: boolean;
  videoError: number | null;
  audioMode: AudioMode;
  audioAuto: boolean;
  onChooseAudio: (mode: AudioMode) => void;
  noisy: boolean;
  onNoisy: (noisy: boolean) => void;
  onLoad: (videoId: string) => void;
  /** Everything about singing to a file you own rather than to YouTube. */
  track: TrackChoice;
  picking: boolean;
  onPick: () => void;
  onCancelPick: () => void;
  musicVolume: number;
  onMusicVolume: (percent: number) => void;
  turn: SingingTurn;
  offsetMs: number;
  manual: boolean;
  onManual: (on: boolean) => void;
  onOffsetMs: (ms: number) => void;
  onPlayPause: () => void;
  onResync: () => void;
}) {
  const {
    videoId,
    playing,
    videoError,
    audioMode,
    audioAuto,
    onChooseAudio,
    noisy,
    onNoisy,
    onLoad,
    track,
    picking,
    onPick,
    onCancelPick,
    musicVolume,
    onMusicVolume,
    turn,
    offsetMs,
    manual,
    onManual,
    onOffsetMs,
    onPlayPause,
    onResync,
  } = props;

  return (
    <section aria-label="Karaoke" className="w-full">
      {picking ? (
        <SongPicker
          onLoad={onLoad}
          videoError={videoError}
          hasSong={videoId !== null}
          onCancel={onCancelPick}
          track={track}
        />
      ) : (
        <Transport
          videoId={videoId}
          videoError={videoError}
          playing={playing}
          audioMode={audioMode}
          audioAuto={audioAuto}
          onChooseAudio={onChooseAudio}
          noisy={noisy}
          onNoisy={onNoisy}
          musicVolume={musicVolume}
          onMusicVolume={onMusicVolume}
          turn={turn}
          offsetMs={offsetMs}
          manual={manual}
          onManual={onManual}
          onOffsetMs={onOffsetMs}
          onPlayPause={onPlayPause}
          onResync={onResync}
          onPick={onPick}
        />
      )}
    </section>
  );
}

/**
 * Switches the answer mid-song, since putting headphones on is exactly the
 * thing someone does once they hear how the speakers sound.
 */
function AudioSwitch({
  audioMode,
  audioAuto,
  onChoose,
}: {
  audioMode: AudioMode;
  audioAuto: boolean;
  onChoose: (mode: AudioMode) => void;
}) {
  const other: AudioMode = audioMode === "headphones" ? "speakers" : "headphones";
  return (
    <button
      type="button"
      onClick={() => onChoose(other)}
      title={
        audioAuto
          ? "Audio mode was detected from your audio device; choosing overrides it"
          : `Switch to ${other}`
      }
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

/**
 * Picking a track you own, which is the only way this app can change speed.
 *
 * Two files rather than one, and that is not an oversight: the audio carries no
 * words and lyrics carry no sound. An .lrc is a plain text file of timestamps,
 * and without one the song still plays perfectly — you simply sing from memory.
 */
function TrackPicker({ track }: { track: TrackChoice }) {
  const audioId = useId();
  const lyricsId = useId();

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label
          htmlFor={audioId}
          className="cursor-pointer rounded-[2px] border border-[var(--lamp)]/45 px-4 py-1.5 tracking-wide text-[var(--lamp)] transition-colors hover:bg-[var(--lamp)]/10"
        >
          {track.ready ? "Change the audio" : "Choose the audio"}
        </label>
        <input
          id={audioId}
          type="file"
          accept="audio/*"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) track.onAudioFile(file);
            // Cleared so choosing the same file twice still fires a change.
            e.target.value = "";
          }}
        />

        <label
          htmlFor={lyricsId}
          className="cursor-pointer rounded-[2px] px-2 py-1.5 text-[var(--mist)] underline decoration-dotted decoration-[var(--mist)]/40 underline-offset-4 transition-colors hover:text-[var(--cream)]"
        >
          {track.hasLyrics ? "Change the lyrics" : "Add lyrics (.lrc, optional)"}
        </label>
        <input
          id={lyricsId}
          type="file"
          accept=".lrc,text/plain"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) track.onLyricsFile(file);
            e.target.value = "";
          }}
        />

        {track.loading && (
          <span className="tracking-[0.3em] text-[var(--lamp)]">DECODING</span>
        )}
      </div>

      <p className="text-[0.65rem] leading-relaxed text-[var(--mist)]">
        {track.error !== null ? (
          <span role="alert" className="text-[var(--cream)]">
            <span aria-hidden className="mr-1 text-[var(--neon)]">
              ●
            </span>
            {track.error}
          </span>
        ) : (
          <>
            The file stays on this computer — only the position is shared, so you
            each open your own copy. In exchange the song can be nudged a few
            thousandths faster to close a gap, which a YouTube video cannot do.
          </>
        )}
      </p>
    </div>
  );
}

function SongPicker({
  onLoad,
  videoError,
  hasSong,
  onCancel,
  track,
}: {
  onLoad: (videoId: string) => void;
  videoError: number | null;
  /** Whether closing returns to a song, or to a transport waiting for one. */
  hasSong: boolean;
  onCancel: () => void;
  track: TrackChoice;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);
  const [own, setOwn] = useState(false);
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
      <div className="flex w-full basis-full items-center gap-3">
        <span aria-hidden className="shrink-0 text-base">
          🎤
        </span>
        {/* Two genuinely different things, not two ways to do one: a video
            cannot change speed, and a file has no words of its own. Naming
            them as a choice is cheaper than explaining it afterwards. */}
        <div role="tablist" aria-label="Where the song comes from" className="flex gap-1">
          {[
            { own: false, label: "YouTube link" },
            { own: true, label: "A track you own" },
          ].map((tab) => (
            <button
              key={tab.label}
              type="button"
              role="tab"
              aria-selected={own === tab.own}
              onClick={() => setOwn(tab.own)}
              className={`rounded-[2px] px-3 py-1 tracking-wide transition-colors ${
                own === tab.own
                  ? "bg-[var(--lamp)]/15 text-[var(--lamp)]"
                  : "text-[var(--mist)] hover:text-[var(--cream)]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onCancel}
          aria-label={
            hasSong ? "Close and keep the current song" : "Close without choosing a song"
          }
          className="ml-auto shrink-0 rounded-[2px] px-2 py-1.5 text-base leading-none text-[var(--mist)] transition-colors hover:text-[var(--cream)]"
        >
          ✕
        </button>
      </div>

      {own ? (
        <TrackPicker track={track} />
      ) : (
        <>
      <div className="flex min-w-0 flex-1 items-center gap-2">
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
        </>
      )}
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

/** What the delay is doing right now, in the one place that says it. */
export function turnStatus(turn: SingingTurn): string {
  if (turn === "them") {
    return "The music is holding back so their singing lands on the beat.";
  }
  if (turn === "you") {
    return "The music is running straight so your voice lands on theirs.";
  }
  return "The music is waiting for someone to sing.";
}

/**
 * Reports how far this side's music is running behind, and lets it be taken
 * over by hand.
 *
 * Their voice spends a couple of hundred milliseconds crossing the internet
 * while your song carries on without it, so they always sound like they are
 * dragging — even though they are singing perfectly to their own copy.
 * Rewinding your music by that same amount lines the two up.
 *
 * It can only ever be right for one of you at a time: two equal delays cancel
 * exactly and leave the gap where it started. So this is no longer a switch to
 * flip. Whoever is listening is delayed, whoever is singing is not, and the
 * turn changes hands on its own — which is why the only control left here is
 * the one for overruling the measurement.
 */
function DelayControl({
  offsetMs,
  manual,
  onManual,
  onOffsetMs,
}: {
  offsetMs: number;
  manual: boolean;
  onManual: (on: boolean) => void;
  onOffsetMs: (ms: number) => void;
}) {
  const id = useId();
  return (
    <div className="flex shrink-0 items-center gap-2">
      <label className="inline-flex shrink-0 items-center gap-1.5 text-[var(--mist)]">
        <input
          type="checkbox"
          checked={manual}
          onChange={(e) => onManual(e.target.checked)}
          className="accent-[var(--lamp)]"
        />
        Set the delay myself
      </label>

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
        disabled={!manual}
        onChange={(e) => onOffsetMs(Number(e.target.value))}
        aria-valuetext={`${offsetMs} milliseconds behind`}
        className="h-1 w-20 cursor-pointer appearance-none rounded-full bg-[var(--edge)] accent-[var(--lamp)] disabled:cursor-not-allowed disabled:opacity-40"
      />
      <span className="w-12 tabular-nums text-[var(--mist)]">{offsetMs}ms</span>
    </div>
  );
}

function Transport({
  videoId,
  videoError,
  playing,
  audioMode,
  audioAuto,
  onChooseAudio,
  noisy,
  onNoisy,
  musicVolume,
  onMusicVolume,
  turn,
  offsetMs,
  manual,
  onManual,
  onOffsetMs,
  onPlayPause,
  onResync,
  onPick,
}: {
  videoId: string | null;
  videoError: number | null;
  playing: boolean;
  audioMode: AudioMode;
  audioAuto: boolean;
  onChooseAudio: (mode: AudioMode) => void;
  noisy: boolean;
  onNoisy: (noisy: boolean) => void;
  musicVolume: number;
  onMusicVolume: (percent: number) => void;
  turn: SingingTurn;
  offsetMs: number;
  manual: boolean;
  onManual: (on: boolean) => void;
  onOffsetMs: (ms: number) => void;
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
          disabled={videoId === null}
          onClick={onPlayPause}
          aria-label={playing ? "Pause the song" : "Play the song"}
          className="relative inline-flex shrink-0 items-center rounded-[2px] border border-[var(--lamp)]/45 px-4 py-1.5 tracking-wide text-[var(--lamp)] transition-colors hover:bg-[var(--lamp)]/10 disabled:cursor-not-allowed disabled:bg-[var(--mist)]/25 disabled:text-[var(--mist)]"
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
          disabled={videoId === null}
          onClick={onResync}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-[2px] px-2 py-1.5 text-[var(--mist)] transition-colors hover:text-[var(--cream)] disabled:cursor-not-allowed disabled:text-[var(--mist)]/40"
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
          {videoId === null ? "Choose song" : "Change song"}
        </button>

        <MusicVolume value={musicVolume} onChange={onMusicVolume} />

        <DelayControl
          offsetMs={offsetMs}
          manual={manual}
          onManual={onManual}
          onOffsetMs={onOffsetMs}
        />

        <AudioSwitch audioMode={audioMode} audioAuto={audioAuto} onChoose={onChooseAudio} />

        <NoisyToggle noisy={noisy} onNoisy={onNoisy} />
      </div>

      <p className="w-full basis-full text-[0.65rem] text-[var(--mist)]">
        {videoError !== null ? (
          <span role="alert">{videoErrorMessage(videoError)}</span>
        ) : (
          <>
            {turnStatus(turn)}
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
