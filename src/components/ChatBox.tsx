"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import { CHAT_MAX_CHARS } from "@/lib/rtc/protocol";
import { formatClock, type ChatLine } from "@/lib/ui/chatLog";

/**
 * The deliberately small conversation that lives beside the film, rather than
 * competing with it. The room owns the messages; this component owns only the
 * unfinished thought in its input.
 */
export function ChatBox(props: {
  lines: readonly ChatLine[];
  onSend: (text: string) => void;
  /** False when the channel is not open; the box says so rather than lying. */
  ready: boolean;
}) {
  const { lines, onSend, ready } = props;
  const [text, setText] = useState("");
  const [glowing, setGlowing] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const sendable = ready && text.trim().length > 0;

  useEffect(() => {
    const element = list.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [lines]);

  function send() {
    const message = text.trim();
    if (!ready || message.length === 0) return;
    onSend(message);
    setText("");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    send();
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  return (
    <section
      aria-label="Chat"
      className="relative w-full overflow-visible rounded-[6px]"
      onMouseEnter={() => setGlowing(true)}
      onMouseLeave={() => setGlowing(false)}
      onFocusCapture={() => setGlowing(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setGlowing(false);
      }}
    >
      {/* The bloom is its own layer so changing its opacity remains a quiet,
          composited response instead of drawing a loud shadow around chat. */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -inset-3 rounded-[8px]"
        style={{
          background: "radial-gradient(ellipse at 50% 100%, var(--lamp), transparent 68%)",
          filter: "blur(14px)",
        }}
        animate={{ opacity: glowing ? 0.16 : 0.07 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.3, ease: "easeOut" }}
      />

      <div className="relative z-10 rounded-[6px] border border-[var(--edge)] bg-[var(--letterbox)]/85 px-2.5 py-2">
        <div
          ref={list}
          role="log"
          aria-label="Messages"
          aria-live="polite"
          aria-relevant="additions text"
          className="max-h-28 min-h-8 space-y-1 overflow-y-auto pr-1 text-xs"
        >
          {lines.length === 0 ? (
            <p className="py-0.5 text-[0.65rem] text-[var(--mist)]">A quiet line travels here.</p>
          ) : (
            lines.map((line) => <ChatLineView key={line.id} line={line} />)
          )}
        </div>

        <form onSubmit={submit} className="mt-2 flex items-center gap-1.5 border-t border-[var(--edge)] pt-2">
          <label htmlFor="chat-message" className="sr-only">
            Message
          </label>
          <input
            id="chat-message"
            type="text"
            value={text}
            disabled={!ready}
            maxLength={CHAT_MAX_CHARS}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={keyDown}
            placeholder={ready ? "Say it softly" : "Chat is waiting"}
            className="min-w-0 flex-1 rounded-[2px] border border-[var(--edge)] bg-[var(--night)]/60 px-2 py-1 text-xs text-[var(--cream)] placeholder:text-[var(--mist)]/55 focus:border-[var(--lamp)]/50 focus:outline-none disabled:cursor-not-allowed disabled:text-[var(--mist)]/55"
          />
          <button
            type="submit"
            disabled={!sendable}
            className="shrink-0 rounded-[2px] border border-[var(--lamp)]/45 px-2.5 py-1 text-xs text-[var(--lamp)] transition-colors hover:bg-[var(--lamp)]/10 disabled:cursor-not-allowed disabled:border-[var(--edge)] disabled:text-[var(--mist)]/50"
          >
            Send
          </button>
        </form>
        {!ready ? <p className="mt-1.5 text-[0.65rem] text-[var(--mist)]">Waiting for the chat connection.</p> : null}
      </div>
    </section>
  );
}

function ChatLineView({ line }: { line: ChatLine }) {
  return (
    <article className={`flex ${line.mine ? "justify-end text-right" : "justify-start text-left"}`}>
      <div className="max-w-[88%]">
        <p className={line.mine ? "text-[var(--lamp)]" : "text-[var(--mist)]"}>
          <span className="mr-1.5 text-[0.65rem] text-[var(--cream)]/70">{line.mine ? "You" : "Them"}</span>
          {line.text}
        </p>
        <time className="text-[0.6rem] text-[var(--mist)]/60" dateTime={new Date(line.at).toISOString()}>
          {formatClock(line.at)}
        </time>
      </div>
    </article>
  );
}
