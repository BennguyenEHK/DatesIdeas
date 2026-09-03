"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnState } from "@/lib/rtc/usePeerConnection";
import type { PathInfo } from "@/lib/rtc/path";
import type { AudioFormat } from "@/lib/rtc/audioStats";

const LABEL: Record<ConnState, string> = {
  idle: "Getting ready",
  connecting: "Connecting",
  connected: "Connected",
  reconnecting: "Reconnecting",
  failed: "Connection lost",
};

const DOT: Record<ConnState, string> = {
  idle: "bg-[var(--mist)]",
  connecting: "bg-[var(--lamp)]",
  connected: "bg-[var(--lamp)]",
  reconnecting: "bg-[var(--neon)]",
  failed: "bg-[var(--neon)]",
};

function Item({ children }: { children: React.ReactNode }) {
  return <span className="text-[var(--mist)]">{children}</span>;
}

/**
 * Past this, the other person's singing arrives late enough to hear as
 * dragging however well the rest of the call is behaving. Worth calling out,
 * because the buffer is the one part of the delay that is not distance.
 */
const LATE_VOICE_BUFFER_MS = 200;

/**
 * Anything below 32kHz is a voice-call profile rather than a music one. The
 * usual cause is a Bluetooth headset whose microphone was opened, which drops
 * the whole device to hands-free mode behind the browser's back.
 */
function isNarrowband(format: AudioFormat): boolean {
  return format.clockRateHz !== null && format.clockRateHz < 32000;
}

/** "opus 48k stereo", or as much of it as the browser actually reported. */
function describeAudio(format: AudioFormat): string {
  const parts = [format.codec];
  if (format.clockRateHz !== null) {
    parts.push(`${Math.round(format.clockRateHz / 1000)}k`);
  }
  if (format.channels !== null) {
    parts.push(format.channels >= 2 ? "stereo" : "mono");
  }
  return parts.join(" ");
}

export function ConnectionStatus({
  state,
  path,
  sending,
  rtt,
  jitterMs,
  audioJitterMs,
  audioFormat,
  audioKbps,
  gestureReady,
  gestureError,
  gesturesOn,
  onToggleGestures,
  onReport,
  onRetry,
}: {
  state: ConnState;
  path: PathInfo | null;
  sending: boolean;
  rtt: number;
  jitterMs: number | null;
  /** The voice buffer — the one that decides how late their singing lands. */
  audioJitterMs: number | null;
  audioFormat: AudioFormat | null;
  audioKbps: number | null;
  gestureReady: boolean;
  gestureError: string | null;
  gesturesOn: boolean;
  onToggleGestures: (next: boolean) => void;
  /** Builds the pasteable diagnostic text, at the moment it is asked for. */
  onReport: () => string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
      <span className="flex items-center gap-2 text-[var(--cream)]">
        <span className={`h-1.5 w-1.5 rounded-full ${DOT[state]}`} />
        {LABEL[state]}
      </span>

      {/* Two numbers, deliberately. Ours is measured in JavaScript and so
          includes any time the main thread spent busy; the browser's is taken
          below JavaScript and is the network alone. A large gap between them
          says the delay is our own doing, not the distance. */}
      {state === "connected" && rtt > 0 && <Item>{Math.round(rtt)}ms</Item>}

      {/* Honest about the path. Never imply a direct link when there isn't one. */}
      {state === "connected" && path && (
        <Item>
          <span className={path.relayed ? "text-[var(--neon)]" : undefined}>
            {path.relayed ? "via relay" : "direct"}
          </span>
          {path.netRtt !== null && ` · net ${Math.round(path.netRtt)}ms`}
        </Item>
      )}

      {/* A receive-only session used to fail silently: your partner saw both
          tiles while you saw only yourself. Say it out loud instead. */}
      {state === "connected" && !sending && (
        <span className="text-[var(--neon)]">
          They can&apos;t see you — your camera wasn&apos;t ready. Reconnect to fix.
        </span>
      )}

      {/* The status text IS the switch: whatever state you are in is the
          thing you click. It is yours alone — their camera keeps reading
          gestures either way, and you keep seeing what they send. */}
      {gestureError ? (
        <Item>Gestures unavailable here — you&apos;ll still see theirs</Item>
      ) : (
        <button
          onClick={() => onToggleGestures(!gesturesOn)}
          aria-pressed={gesturesOn}
          title={
            gesturesOn
              ? "Stop reading your camera for gestures"
              : "Read your camera for gestures again"
          }
          className={`underline decoration-dotted underline-offset-4 transition-colors ${
            gesturesOn
              ? "text-[var(--mist)] decoration-[var(--mist)]/40 hover:text-[var(--cream)]"
              : "text-[var(--mist)]/50 decoration-[var(--mist)]/25 hover:text-[var(--mist)]"
          }`}
        >
          {!gesturesOn
            ? "Gestures off"
            : gestureReady
              ? "Gestures on"
              : "Warming up gestures"}
        </button>
      )}

      {/* What the browser is holding back before playing it. Never shows up in
          `rtt`, which times a text message, yet on a long link it can outweigh
          the whole journey.

          Both are shown, and the voice comes first. It used to be video alone —
          which was the wrong one to display, because the voice buffer is what
          decides how late their singing arrives and it was measured all along
          without ever being surfaced. The two also behave differently, so an
          average of them would describe neither. */}
      {state === "connected" && (audioJitterMs !== null || jitterMs !== null) && (
        <Item>
          buffer{" "}
          {audioJitterMs !== null && (
            <span
              className={
                audioJitterMs > LATE_VOICE_BUFFER_MS
                  ? "text-[var(--neon)]"
                  : undefined
              }
            >
              {Math.round(audioJitterMs)}ms voice
            </span>
          )}
          {audioJitterMs !== null && jitterMs !== null && " · "}
          {jitterMs !== null && `${Math.round(jitterMs)}ms video`}
        </Item>
      )}

      {/* What the voice is actually arriving as.

          "It sounds filtered" is not something you can debug by listening
          harder, and every cause looks the same from the outside. This says
          which it is: 48k stereo means the codec is fine and the problem is in
          the room, while 16k mono means the device fell back to a narrowband
          phone-call profile and nothing in this app can undo that. Marked in
          neon when it has collapsed, because that is the case worth noticing. */}
      {state === "connected" && audioFormat && (
        <Item>
          <span
            className={
              isNarrowband(audioFormat) ? "text-[var(--neon)]" : undefined
            }
          >
            voice {describeAudio(audioFormat)}
          </span>
          {audioKbps !== null && ` · ${Math.round(audioKbps)}kbps`}
        </Item>
      )}

      {state === "connected" && <CopyReport build={onReport} />}

      {(state === "failed" || state === "reconnecting") && (
        <button
          onClick={onRetry}
          className="text-[var(--lamp)] underline decoration-[var(--lamp)]/40 underline-offset-4 transition-colors hover:decoration-[var(--lamp)]"
        >
          Reconnect
        </button>
      )}
    </div>
  );
}

/**
 * Puts the whole connection report on the clipboard.
 *
 * The reason this is a button and not a console log: the calls worth
 * diagnosing happen late at night, on a laptop, in another country, and the
 * person having the bad call is not going to open developer tools. One click
 * and the evidence is in a chat message.
 *
 * Falls back to a selectable box when the clipboard refuses — which it does
 * whenever the page is not focused, and silently. A copy button that quietly
 * does nothing is worse than no copy button.
 */
function CopyReport({ build }: { build: () => string }) {
  const [copied, setCopied] = useState(false);
  const [fallback, setFallback] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const pending = timer;
    return () => {
      if (pending.current !== null) clearTimeout(pending.current);
    };
  }, []);

  const copy = useCallback(() => {
    const text = build();
    const shown = () => {
      setCopied(true);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2200);
    };
    navigator.clipboard?.writeText(text).then(shown, () => setFallback(text));
  }, [build]);

  if (fallback !== null) {
    return (
      <textarea
        readOnly
        autoFocus
        value={fallback}
        onFocus={(e) => e.currentTarget.select()}
        aria-label="Connection report — copy this"
        className="h-20 w-72 rounded-[2px] border border-[var(--edge)] bg-transparent p-2 font-mono text-[0.6rem] text-[var(--mist)]"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={copy}
      title="Copy everything known about this connection, to paste to someone who can read it"
      className="text-[var(--mist)] underline decoration-dotted decoration-[var(--mist)]/40 underline-offset-4 transition-colors hover:text-[var(--cream)]"
    >
      {copied ? "Report copied" : "Copy report"}
    </button>
  );
}
