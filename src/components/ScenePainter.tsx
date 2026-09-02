"use client";

import { useEffect, useRef } from "react";

/**
 * A canvas that repaints itself whenever it changes size.
 *
 * This exists so the live photo booth and the saved photograph are painted by
 * literally the same functions. An earlier version of this design had a second
 * painter written in CSS mirroring the canvas rules, and it would have drifted
 * the first time anyone edited one and forgot the other — one theme, two
 * descriptions, and eventually a saved photo that did not match the preview.
 * Here there is one description and one painter, used twice.
 *
 * Sized in device pixels rather than CSS pixels: on a high-density screen a
 * canvas laid out at 800px wide is 1600 real pixels, and painting 800 of them
 * across it gives a visibly soft gradient next to crisp text.
 */
export function ScenePainter({
  paint,
  className = "",
}: {
  /** Draws into a box measured in device pixels. */
  paint: (ctx: CanvasRenderingContext2D, box: { width: number; height: number }) => void;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paintRef = useRef(paint);
  useEffect(() => {
    paintRef.current = paint;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.round(rect.width * dpr);
      const height = Math.round(rect.height * dpr);
      // Assigning width or height clears the canvas, so only do it when the
      // size actually changed — otherwise every repaint starts with a flicker.
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      paintRef.current(ctx, { width, height });
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
    // `paint` is deliberately absent: it is read through a ref, and depending
    // on it would tear down the observer on every render of the parent.
  }, []);

  // Repaint when the drawing itself changes, which is what a theme switch is.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || canvas.width === 0) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    paint(ctx, { width: canvas.width, height: canvas.height });
  }, [paint]);

  return <canvas ref={canvasRef} aria-hidden className={className} />;
}
