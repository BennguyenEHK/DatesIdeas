"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PeerMessage } from "@/lib/rtc/protocol";
import { EMPTY_SCENE, applyOp, newItemId, undoTarget, type CanvasOp, type Scene } from "./ops";
import { EMPTY_REDO, itemToOp, popRedo, pushRedo, type RedoStack } from "./history";
import { MENU_SESSION, supersedes, type CreateSession } from "./session";

/**
 * CreateSpace's side of the room: the shared scene, and the channel under it.
 *
 * Every edit from this person goes through `apply`, which changes the scene here
 * and sends the same operation to the other browser. Every edit from them comes
 * in through `accept`. Both run the identical applyOp, and ops.ts guarantees the
 * same set of operations yields the same picture in any order.
 */
export function useCreateSpace({
  send,
  identity = "",
  now = Date.now,
  onFinish,
}: {
  send: (message: PeerMessage) => void;
  identity?: string;
  now?: () => number;
  /** Save while editing a booth strip, from either screen. Gets the marks at that moment. */
  onFinish?: (scene: Scene) => void;
}) {
  const [scene, setScene] = useState<Scene>(EMPTY_SCENE);
  const [baseItemId, setBaseItemId] = useState<string | null>(null);
  const [session, setSessionState] = useState<CreateSession>(MENU_SESSION);
  const [redo, setRedo] = useState<RedoStack>(EMPTY_REDO);

  const latestScene = useRef<Scene>(EMPTY_SCENE);
  const latestBase = useRef<string | null>(null);
  const latestSession = useRef<CreateSession>(MENU_SESSION);
  const latestRedo = useRef<RedoStack>(EMPTY_REDO);
  const finishedNonces = useRef(new Set<string>());
  useEffect(() => {
    latestScene.current = scene;
  }, [scene]);
  useEffect(() => {
    latestBase.current = baseItemId;
  }, [baseItemId]);
  useEffect(() => { latestSession.current = session; }, [session]);
  useEffect(() => { latestRedo.current = redo; }, [redo]);

  const updateRedo = useCallback((next: RedoStack) => {
    latestRedo.current = next;
    setRedo(next);
  }, []);

  const apply = useCallback(
    (op: CanvasOp) => {
      const existed = op.kind === "sticker" && latestScene.current.items.some((item) => item.id === op.sticker.id);
      const next = applyOp(latestScene.current, op);
      latestScene.current = next;
      setScene(next);
      if ((op.kind === "stroke" && op.stroke.author === identity) ||
        (op.kind === "sticker" && op.sticker.author === identity && !existed)) {
        updateRedo(EMPTY_REDO);
      }
      send({ t: "canvas", op });
    },
    [identity, send, updateRedo],
  );

  const setBase = useCallback(
    (itemId: string | null) => {
      latestBase.current = itemId;
      setBaseItemId(itemId);
      send({ t: "canvas-base", itemId });
    },
    [send],
  );

  const undo = useCallback(() => {
    const id = undoTarget(latestScene.current, identity);
    if (id === null) return;
    const item = latestScene.current.items.find((candidate) => candidate.id === id);
    if (item === undefined) return;
    updateRedo(pushRedo(latestRedo.current, item));
    const next = applyOp(latestScene.current, { kind: "remove", id });
    latestScene.current = next;
    setScene(next);
    send({ t: "canvas", op: { kind: "remove", id } });
  }, [identity, send, updateRedo]);

  const redoLast = useCallback(() => {
    const { stack, item } = popRedo(latestRedo.current);
    if (item === null) return;
    updateRedo(stack);
    // A fresh id, not the undone one. `remove` carries no version, so re-adding
    // the same id could meet the other screen before the remove does: the add
    // would be a duplicate there and the late remove would then delete it,
    // leaving the two pictures different. A new id makes the pair commute.
    const op = itemToOp({ ...item, id: newItemId() });
    const next = applyOp(latestScene.current, op);
    latestScene.current = next;
    setScene(next);
    send({ t: "canvas", op });
  }, [send, updateRedo]);

  const setSession = useCallback((patch: Partial<Omit<CreateSession, "at" | "by">>) => {
    const next = { ...latestSession.current, ...patch, at: now(), by: identity };
    latestSession.current = next;
    setSessionState(next);
    send({ t: "canvas-session", session: next });
  }, [identity, now, send]);

  const finish = useCallback(() => {
    const nonce = `${now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    finishedNonces.current.add(nonce);
    send({ t: "canvas-finish", nonce });
    onFinish?.(latestScene.current);
  }, [now, onFinish, send]);

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
      return;
    }
    if (message.t === "canvas-session" && supersedes(message.session, latestSession.current)) {
      latestSession.current = message.session;
      setSessionState(message.session);
      return;
    }
    if (message.t === "canvas-finish" && !finishedNonces.current.has(message.nonce)) {
      finishedNonces.current.add(message.nonce);
      onFinish?.(latestScene.current);
    }
  }, [onFinish]);

  /**
   * Sends the whole picture to somebody who has just (re)joined.
   *
   * Every item goes as the operation that would create it. Because applyOp is
   * idempotent by id, sending this to a screen that already has some of it is
   * harmless -- which is what makes it safe for BOTH sides to resync at once.
   */
  const resync = useCallback(() => {
    send({ t: "canvas-base", itemId: latestBase.current });
    send({ t: "canvas-session", session: latestSession.current });
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

  return {
    scene, baseItemId, session, apply, setBase, accept, resync, setSession, finish,
    undo, redo: redoLast, canUndo: undoTarget(scene, identity) !== null, canRedo: redo.length > 0,
  };
}
