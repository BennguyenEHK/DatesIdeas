"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePeerConnection } from "@/lib/rtc/usePeerConnection";
import { useGestureDetection } from "@/lib/vision/useGestureDetection";
import { useSession } from "@/lib/history/useSession";
import { Ambience } from "@/components/Ambience";
import { Monogram } from "@/components/Monogram";
import { VideoStage } from "@/components/VideoStage";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { useMemeQueue } from "@/lib/ui/useMemeQueue";
import type { MemeId, PeerMessage } from "@/lib/rtc/protocol";

/**
 * The call page is framed as a widescreen film still: every piece of interface
 * lives in the letterbox bars above and below the stage, so decoration can
 * never creep onto the video itself.
 */
export function RoomClient({ code }: { code: string }) {
  const { memes, show } = useMemeQueue();
  const peerRef = useRef<ReturnType<typeof usePeerConnection> | null>(null);

  const onMessage = useCallback(
    (msg: PeerMessage) => {
      if (msg.t !== "meme") return;
      const clock = peerRef.current?.clock;
      // Scheduled, not immediate: both screens land on the same instant. With
      // no clock there is no shared instant to aim at, so show it now rather
      // than dropping it.
      if (!clock) {
        show(msg.id);
        return;
      }
      clock.scheduleAt(msg.showAt, () => show(msg.id));
    },
    [show],
  );

  const peer = usePeerConnection(code, onMessage);
  useEffect(() => {
    peerRef.current = peer;
  });

  const session = useSession(code, peer.state === "connected");

  const onGesture = useCallback(
    (id: MemeId) => {
      session.recordMeme(id);
      const clock = peerRef.current?.clock;
      // No channel yet. Returning here used to swallow the gesture whole, so a
      // working detector was indistinguishable from a broken one. Show it
      // locally: they cannot see it, but you can see that it fired.
      if (!clock) {
        show(id);
        return;
      }
      const showAt = clock.now() + clock.leadTime();
      peerRef.current?.send({ t: "meme", id, showAt });
      // The sender schedules too. Rendering now would be faster but would break
      // the symmetry the design requires.
      clock.scheduleAt(showAt, () => show(id));
    },
    [session, show],
  );

  const gesture = useGestureDetection(peer.localStream, onGesture);

  return (
    <>
      <Ambience />
      <div className="flex min-h-screen flex-1 flex-col">
        {/* Top letterbox bar */}
        <header className="bar-top flex items-center justify-between bg-[var(--letterbox)] px-5 py-3">
          <Monogram size="compact" />
          <span className="font-[family-name:var(--font-display)] text-sm tracking-[0.45em] text-[var(--lamp)]">
            {code}
          </span>
        </header>

        {/* The stage */}
        <main className="flex flex-1 items-center justify-center px-4 py-6 md:px-8">
          <div className="w-full max-w-6xl">
            <VideoStage
              local={peer.localStream}
              remote={peer.remoteStream}
              memes={memes}
              mediaError={peer.mediaError}
            />
          </div>
        </main>

        {/* Bottom letterbox bar */}
        <footer className="bar-bottom bg-[var(--letterbox)] px-5 py-3">
          <ConnectionStatus
            state={peer.state}
            relayed={peer.relayed}
            sending={peer.sending}
            rtt={peer.rtt}
            gestureReady={gesture.ready}
            gestureError={gesture.error}
            onRetry={peer.retry}
          />
        </footer>
      </div>
    </>
  );
}
