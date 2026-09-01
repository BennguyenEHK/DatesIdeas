"use client";

import { useId, useState, type FormEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import { youTubeId } from "@/lib/media/youtube";

/**
 * The karaoke control panel, living in the bottom letterbox bar under the
 * video. Headphones are gated first and exclusively: a synced song playing
 * into an open mic is one round trip away from becoming an echo, so nothing
 * else here is reachable until both of you have confirmed.
 */
export function KaraokePanel(props: {
  videoId: string | null;
  playing: boolean;
  headphonesConfirmed: boolean;
  onConfirmHeadphones: () => void;
  onLoad: (videoId: string) => void;
  onPlayPause: () => void;
  onResync: () => void;
  onClear: () => void;
}) {
  const {
    videoId,
    playing,
    headphonesConfirmed,
    onConfirmHeadphones,
    onLoad,
    onPlayPause,
    onResync,
    onClear,
  } = props;

  return (
    <section aria-label="Karaoke" className="w-full">
      {!headphonesConfirmed ? (
        <HeadphoneGate onConfirm={onConfirmHeadphones} />
      ) : videoId === null ? (
        <SongPicker onLoad={onLoad} />
      ) : (
        <Transport
          playing={playing}
          onPlayPause={onPlayPause}
          onResync={onResync}
          onClear={onClear}
        />
      )}
    </section>
  );
}

function HeadphoneGate({ onConfirm }: { onConfirm: () => void }) {
  return (
    <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 text-xs">
      <div className="flex min-w-0 flex-1 items-start gap-2 text-[var(--mist)]">
        <HeadphoneIcon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--lamp)]" />
        <p className="leading-relaxed">
          Without headphones, your mic picks up the song from your speakers and sends
          it back — arriving a beat behind the copy your partner is already playing.
          Put on headphones so there is only one version of the song in the room.
        </p>
      </div>
      <button
        type="button"
        onClick={onConfirm}
        className="shrink-0 rounded-[2px] border border-[var(--lamp)]/45 px-4 py-1.5 tracking-wide text-[var(--lamp)] transition-colors hover:bg-[var(--lamp)]/10"
      >
        We&rsquo;re both wearing headphones
      </button>
    </div>
  );
}

function SongPicker({ onLoad }: { onLoad: (videoId: string) => void }) {
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
        ) : (
          <p className="text-[var(--mist)]">A karaoke or lyrics video works best.</p>
        )}
      </div>
    </form>
  );
}

function Transport({
  playing,
  onPlayPause,
  onResync,
  onClear,
}: {
  playing: boolean;
  onPlayPause: () => void;
  onResync: () => void;
  onClear: () => void;
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

        <button
          type="button"
          onClick={onClear}
          className="shrink-0 rounded-[2px] px-2 py-1.5 text-[var(--mist)] transition-colors hover:text-[var(--cream)]"
        >
          Change song
        </button>
      </div>

      <p className="w-full basis-full text-[0.65rem] text-[var(--mist)]">
        Resync pulls you both back together if an ad or a stall knocked the song out of
        step.
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
