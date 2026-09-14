"use client";

import { useEffect, useRef } from "react";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable
  );
}

/** One listener per workshop keeps every tray from competing for the same shortcut. */
export function useWorkshopShortcuts(onUndo: () => void, onRedo: () => void): void {
  const undo = useRef(onUndo);
  const redo = useRef(onRedo);

  useEffect(() => {
    undo.current = onUndo;
    redo.current = onRedo;
  }, [onRedo, onUndo]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTypingTarget(event.target) || !(event.ctrlKey || event.metaKey)) return;

      const key = event.key.toLowerCase();
      if (key === "y" || (key === "z" && event.shiftKey)) {
        event.preventDefault();
        redo.current();
        return;
      }
      if (key === "z") {
        event.preventDefault();
        undo.current();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
