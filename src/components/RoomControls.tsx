"use client";

import { formatCountdown } from "@/lib/room/ending";

/**
 * The room's own switches, at the far end of the top letterbox bar.
 *
 * Two of them are hardware and one of them is the ending, and they are set
 * apart from the activity bulbs on purpose. A bulb in this room means a thing
 * you have chosen to do; a microphone is not an activity, and lighting one up
 * to say "on" would read as a fourth thing to pick.
 *
 * So the state language is inverted here. A camera that is working is
 * unremarkable and stays quiet -- no accent, no glow. A camera that is off is
 * the thing worth seeing, and gets the one warning colour in the palette and a
 * line struck through it, the way a lens cap is on or a slate is crossed. The
 * loud state is the silent one.
 */
export function RoomControls({
  micOn,
  camOn,
  onMic,
  onCam,
  endsInMs,
  onEnd,
  onStay,
}: {
  micOn: boolean;
  camOn: boolean;
  onMic: (on: boolean) => void;
  onCam: (on: boolean) => void;
  /** Milliseconds until the evening ends, or null when none has been called. */
  endsInMs: number | null;
  onEnd: () => void;
  onStay: () => void;
}) {
  const ending = endsInMs !== null;

  return (
    <div className="flex items-center gap-2">
      <Switch
        on={micOn}
        onChange={onMic}
        label={micOn ? "Turn microphone off" : "Turn microphone on"}
      >
        <MicIcon />
      </Switch>

      <Switch
        on={camOn}
        onChange={onCam}
        label={camOn ? "Turn camera off" : "Turn camera on"}
      >
        <CameraIcon />
      </Switch>

      {/* Set as the sign beside a cinema screen rather than as another button:
          the display face, letterspaced, in the same slate vocabulary the video
          tiles are labelled with. It is the only control here that ends
          something, and it should not look interchangeable with the two that
          merely switch a device. */}
      {ending ? (
        <div className="flex items-center gap-2">
          <p
            role="status"
            aria-live="polite"
            className="font-[family-name:var(--font-display)] text-[0.7rem] uppercase tracking-[0.28em] text-[var(--neon)]"
          >
            Ending {formatCountdown(endsInMs)}
          </p>
          <button
            type="button"
            onClick={onStay}
            className="rounded-[2px] border border-[var(--lamp)]/50 px-2.5 py-1 text-[0.7rem] tracking-wide text-[var(--lamp)] transition-colors hover:bg-[var(--lamp)]/10"
          >
            Stay
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onEnd}
          className="font-[family-name:var(--font-display)] text-[0.7rem] uppercase tracking-[0.28em] text-[var(--mist)] transition-colors hover:text-[var(--lamp)]"
        >
          End the evening
        </button>
      )}
    </div>
  );
}

/**
 * One hardware switch.
 *
 * The name says what pressing it will DO, and that is the whole of how the
 * state reaches somebody not looking at the screen: "turn microphone on" can
 * only mean it is currently off. There is deliberately no `aria-pressed`
 * alongside it -- that describes the state rather than the action, so a button
 * carrying both announces itself as "turn microphone on, not pressed", which
 * sounds like a contradiction and has to be untangled before it can be used.
 */
function Switch({
  on,
  onChange,
  label,
  children,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  label: string;
  children: React.ReactNode;
}) {
  const base =
    "relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-1 transition-colors duration-300";
  const tone = on
    ? "bg-transparent text-[var(--mist)] ring-[var(--edge)] hover:bg-[var(--lamp)]/10 hover:text-[var(--cream)] hover:ring-[var(--lamp)]/50"
    : "bg-[var(--neon)]/15 text-[var(--neon)] ring-[var(--neon)]/60 hover:bg-[var(--neon)]/25";

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => onChange(!on)}
      className={`${base} ${tone}`}
    >
      {children}
      {/* Drawn over the glyph rather than swapped for a second icon, so the
          thing being switched stays recognisable while it is off. */}
      {!on && (
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className="pointer-events-none absolute inset-0 h-full w-full p-1.5 stroke-current"
          strokeWidth={1.6}
        >
          <path d="M2.5 13.5 13.5 2.5" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}

function MicIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 fill-none stroke-current"
      strokeWidth={1.5}
    >
      <rect x="6" y="1.6" width="4" height="7.5" rx="2" />
      <path d="M3.6 7.2a4.4 4.4 0 0 0 8.8 0M8 11.6v2.6" strokeLinecap="round" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 fill-none stroke-current"
      strokeWidth={1.5}
    >
      <rect x="1.5" y="4" width="9" height="8" rx="1.4" />
      <path d="M10.5 8.2 14.5 5.6v4.8L10.5 7.8z" strokeLinejoin="round" />
    </svg>
  );
}
