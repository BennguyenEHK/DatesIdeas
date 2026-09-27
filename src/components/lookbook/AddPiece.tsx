"use client";

import { useEffect, useRef, useState } from "react";
import type { LookbookView } from "@/lib/lookbook/contract";
import { PIECE_KINDS, type PieceKind } from "@/lib/lookbook/types";
import { openCamera, stopCamera, takePhoto } from "@/lib/album/capture";

const KIND_LABELS: Record<PieceKind, string> = {
  top: "Top",
  bottom: "Bottom",
  dress: "Dress",
  outerwear: "Outerwear",
  shoes: "Shoes",
  bag: "Bag",
  accessory: "Accessory",
  other: "Other",
};

export function AddPiece({ view, onClose }: { view: LookbookView; onClose: () => void }) {
  const [kind, setKind] = useState<PieceKind | null>(null);
  const [label, setLabel] = useState("");
  const [file, setFile] = useState<Blob | null>(null);
  const [message, setMessage] = useState("");
  const [camera, setCamera] = useState<MediaStream | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const close = () => {
    stopCamera(camera);
    setCamera(null);
    onClose();
  };
  useEffect(() => () => stopCamera(camera), [camera]);
  // Attached once the preview exists. The <video> only renders after the
  // camera has opened, so connecting it inside startCamera found no element
  // and left a black box whose shutter took nothing.
  useEffect(() => {
    const element = video.current;
    if (camera === null || element === null) return;
    element.srcObject = camera;
    void element.play().catch(() => {
      // Autoplay refusals are harmless here: the stream is muted and the
      // shutter reads frames whether or not the preview is running.
    });
  }, [camera]);
  const startCamera = async () => {
    try {
      setCamera(await openCamera("environment", false));
    } catch {
      setMessage("The camera could not be opened.");
    }
  };
  const shutter = async () => {
    if (video.current === null) return;
    const photo = await takePhoto(video.current);
    if (photo !== null) {
      setFile(photo);
      stopCamera(camera);
      setCamera(null);
    }
  };
  const add = async () => {
    if (file === null || kind === null) return;
    const saved = await view.addPiece(file, kind, label.trim());
    if (saved) close();
    else setMessage("That piece could not be added. Try again.");
  };
  return (
    <div
      role="dialog"
      aria-label="Add piece"
      className="fixed inset-0 z-30 flex items-end justify-center bg-[var(--letterbox)]/80 p-3 sm:items-center"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded border border-[var(--edge)] bg-[var(--dusk)] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg text-[var(--lamp)]">Add a piece</h2>
          <button
            type="button"
            onClick={close}
            className="min-h-10 min-w-10 text-xl"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void startCamera()}
            disabled={view.adding}
            className="min-h-10 flex-1 rounded border border-[var(--edge)]"
          >
            Take a photo
          </button>
          <label className="flex min-h-10 flex-1 cursor-pointer items-center justify-center rounded border border-[var(--edge)]">
            Choose a photo
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
        </div>
        {camera ? (
          <div className="mt-3">
            <video ref={video} playsInline muted className="aspect-video w-full object-cover" />
            <button
              type="button"
              onClick={() => void shutter()}
              className="mt-2 min-h-10 w-full rounded bg-[var(--lamp)] text-[var(--letterbox)]"
            >
              Take photo
            </button>
          </div>
        ) : null}
        {file ? <p className="mt-3 text-sm text-[var(--mist)]">Photo ready.</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          {PIECE_KINDS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={kind === option}
              onClick={() => setKind(option)}
              className="min-h-10 rounded-full border border-[var(--edge)] px-3 aria-pressed:border-[var(--lamp)] aria-pressed:text-[var(--lamp)]"
            >
              {KIND_LABELS[option]}
            </button>
          ))}
        </div>
        <label className="mt-4 block text-sm text-[var(--mist)]">
          Label (optional)
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            maxLength={60}
            className="mt-1 min-h-10 w-full border border-[var(--edge)] bg-[var(--letterbox)] px-3 text-[var(--cream)]"
          />
        </label>
        {message ? (
          <p role="alert" className="mt-3 text-sm text-[var(--neon)]">
            {message}
          </p>
        ) : null}
        <button
          type="button"
          disabled={view.adding || file === null || kind === null}
          onClick={() => void add()}
          className="mt-4 min-h-11 w-full rounded bg-[var(--lamp)] text-[var(--letterbox)] disabled:opacity-40"
        >
          {view.adding ? "Adding…" : "Add"}
        </button>
      </div>
    </div>
  );
}
