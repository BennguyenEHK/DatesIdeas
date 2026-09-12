"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PeerMessage } from "@/lib/rtc/protocol";
import { EMPTY_SCENE, applyOp, type CanvasOp, type Scene } from "./ops";

/**
 * CreateSpace's side of the room: the shared scene, and the channel under it.
 *
 * Every edit from this person goes through `apply`, which changes the scene here
 * and sends the same operation to the other browser. Every edit from them comes
 * in through `accept`. Both run the identical applyOp, and ops.ts guarantees the
 * same set of operations yields the same picture in any order.
 */
export function useCreateSpace({ send }: { send: (message: PeerMessage) => void }) {
  const [scene, setScene] = useState<Scene>(EMPTY_SCENE);
  const [baseItemId, setBaseItemId] = useState<string | null>(null);

  const latestScene = useRef<Scene>(EMPTY_SCENE);
  const latestBase = useRef<string | null>(null);
  useEffect(() => {
    latestScene.current = scene;
  }, [scene]);
  useEffect(() => {
    latestBase.current = baseItemId;
  }, [baseItemId]);

  const apply = useCallback(
    (op: CanvasOp) => {
      const next = applyOp(latestScene.current, op);
      latestScene.current = next;
      setScene(next);
      send({ t: "canvas", op });
    },
    [send],
  );

  const setBase = useCallback(
    (itemId: string | null) => {
      latestBase.current = itemId;
      setBaseItemId(itemId);
      send({ t: "canvas-base", itemId });
    },
    [send],
  );

  const accept = useCallback((message: PeerMessage) => {
    if (message.t === "canvas") {
      const next = applyOp(latestScene.current, message.op);
      if (next === latestScene.current) return;
      latestScene.current = next;
      setScene(next);
      return;
    }
    if (message.t === "canvas-base") {
      latestBase.current = message.itemId;
      setBaseItemId(message.itemId);
    }
  }, []);

  /**
   * Sends the whole picture to somebody who has just (re)joined.
   *
   * Every item goes as the operation that would create it. Because applyOp is
   * idempotent by id, sending this to a screen that already has some of it is
   * harmless -- which is what makes it safe for BOTH sides to resync at once.
   */
  const resync = useCallback(() => {
    send({ t: "canvas-base", itemId: latestBase.current });
    for (const item of latestScene.current.items) {
      if (item.type === "stroke") {
        const { type, ...stroke } = item;
        void type;
        send({ t: "canvas", op: { kind: "stroke", stroke } });
      } else {
        const { type, ...sticker } = item;
        void type;
        send({ t: "canvas", op: { kind: "sticker", sticker } });
      }
    }
  }, [send]);

  return { scene, baseItemId, apply, setBase, accept, resync };
}
