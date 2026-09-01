"use client";

import type { ConnState } from "@/lib/rtc/usePeerConnection";
import type { PathInfo } from "@/lib/rtc/path";

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

export function ConnectionStatus({
  state,
  path,
  sending,
  rtt,
  jitterMs,
  gestureReady,
  gestureError,
  gesturesOn,
  onToggleGestures,
  onRetry,
}: {
  state: ConnState;
  path: PathInfo | null;
  sending: boolean;
  rtt: number;
  jitterMs: number | null;
  gestureReady: boolean;
  gestureError: string | null;
  gesturesOn: boolean;
  onToggleGestures: (next: boolean) => void;
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

      {/* What the browser is holding video back by. Never shows up in `rtt`,
          which times a text message, yet on a long link it can outweigh the
          whole journey. Worth watching if the picture starts to stutter. */}
      {state === "connected" && jitterMs !== null && (
        <Item>buffer {Math.round(jitterMs)}ms</Item>
      )}

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
