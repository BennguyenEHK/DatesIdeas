"use client";

import { useEffect, useRef, useState } from "react";
import { addToAlbum } from "@/lib/album/upload";
import { baseMimeType } from "@/lib/photo/keepsake";
import { qrDataUrl, QR_SIZE } from "@/lib/photo/qr";
import { formatElapsed } from "@/lib/recording/layout";
import {
  deleteRecording,
  getRecording,
  listRecordings,
  setLoved,
  type RecordingSummary,
} from "@/lib/recording/store";

type MenuState = { item: RecordingSummary; confirming: boolean } | null;

function stamp(at: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(at));
}

export function RecordingsGallery({ room }: { room: string }) {
  const [items, setItems] = useState<RecordingSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const url = useRef<string | null>(null);
  const press = useRef<number | null>(null);

  useEffect(() => {
    void listRecordings(room).then(setItems);
  }, [room]);

  useEffect(() => {
    return () => {
      if (url.current !== null) {
        URL.revokeObjectURL(url.current);
      }
    };
  }, []);

  useEffect(() => {
    if (menu === null) {
      return;
    }

    const away = (event: MouseEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest("[data-recording-menu]")
      ) {
        setMenu(null);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenu(null);
      }
    };

    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [menu]);

  const play = async (id: string) => {
    const recording = await getRecording(id);
    if (recording === null) {
      return;
    }

    if (url.current !== null) {
      URL.revokeObjectURL(url.current);
    }

    const next = URL.createObjectURL(recording.blob);
    url.current = next;
    setPlayUrl(next);
    setSelected(id);
  };

  const remove = async (item: RecordingSummary) => {
    if (await deleteRecording(item.id)) {
      setItems((current) =>
        current.filter((entry) => entry.id !== item.id),
      );
    }

    setMenu(null);
    if (selected === item.id) {
      if (url.current !== null) {
        URL.revokeObjectURL(url.current);
      }

      url.current = null;
      setPlayUrl(null);
      setSelected(null);
    }
  };

  const download = async (item: RecordingSummary) => {
    setBusy("Preparing the QR code");
    setError(null);
    setQr(null);
    setLink(null);

    const recording = await getRecording(item.id);
    if (recording === null) {
      setBusy(null);
      setError("That recording is no longer on this device.");
      return;
    }

    const contentType = baseMimeType(recording.mimeType) ?? recording.blob.type;
    const uploaded = await addToAlbum(recording.blob, {
      kind: "recording",
      contentType,
      sourceRoom: room,
    });
    if (!uploaded.ok || uploaded.item === undefined) {
      setBusy(null);
      setError(uploaded.error ?? "The recording could not be sent.");
      return;
    }

    const response = await fetch(`/api/album/${uploaded.item.id}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room }),
    });
    const body: unknown = await response.json().catch(() => null);
    if (
      !response.ok ||
      typeof body !== "object" ||
      body === null ||
      !("shareUrl" in body) ||
      typeof body.shareUrl !== "string"
    ) {
      const message =
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof body.error === "string"
          ? body.error
          : "The sharing link could not be made.";
      setBusy(null);
      setError(message);
      return;
    }

    setLink(body.shareUrl);
    setQr(await qrDataUrl(body.shareUrl));
    setBusy(null);
    setMenu(null);
  };

  const localSave = async (item: RecordingSummary) => {
    const recording = await getRecording(item.id);
    if (recording === null) {
      return;
    }

    const objectUrl = URL.createObjectURL(recording.blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `festibooth-recording-${item.id}.${
      baseMimeType(recording.mimeType)?.split("/")[1] ?? "webm"
    }`;
    anchor.click();
    URL.revokeObjectURL(objectUrl);
  };

  const love = async (item: RecordingSummary) => {
    const recording = await getRecording(item.id);
    if (recording === null) {
      return;
    }

    const loved = !item.loved;
    await setLoved(item.id, loved);
    setItems((current) =>
      current.map((entry) =>
        entry.id === item.id ? { ...entry, loved } : entry,
      ),
    );
    if (loved) {
      const result = await addToAlbum(recording.blob, {
        kind: "recording",
        contentType: baseMimeType(recording.mimeType) ?? recording.blob.type,
        sourceRoom: room,
      });
      if (!result.ok) {
        setError(result.error ?? "The favourite could not be kept in the album.");
      }
    }
  };

  if (items.length === 0) {
    return (
      <section className="mx-auto max-w-3xl p-8 text-center">
        <h1 className="font-display text-4xl text-[var(--dress)]">
          The cutting room
        </h1>
        <p className="mt-4 text-[var(--mist)]">
          Press record in the call to make the first scene.
        </p>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-5xl p-4 sm:p-8">
      <header className="mb-5 flex items-baseline justify-between border-b border-[var(--edge)] pb-3">
        <h1 className="font-display text-4xl text-[var(--dress)]">
          The cutting room
        </h1>
        <span className="text-sm text-[var(--mist)]">{items.length} takes</span>
      </header>
      {playUrl !== null ? (
        <video
          controls
          autoPlay
          src={playUrl}
          className="mb-5 aspect-video w-full bg-[var(--letterbox)] ring-1 ring-[var(--edge)]"
        />
      ) : null}
      <div className="reel reel-thread">
        <div className="reel-track">
          {items.map((item) => (
            <article
              key={item.id}
              className="reel-frame w-44 bg-[var(--dusk)] text-left"
              data-loved={item.loved}
              aria-current={selected === item.id}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ item, confirming: false });
              }}
              onPointerDown={() => {
                press.current = window.setTimeout(() => {
                  setMenu({ item, confirming: false });
                }, 600);
              }}
              onPointerUp={() => {
                if (press.current !== null) {
                  window.clearTimeout(press.current);
                }

                press.current = null;
              }}
            >
              <button
                type="button"
                onClick={() => {
                  void play(item.id);
                }}
                className="block w-full p-3 text-left"
                aria-label={`Play recording from ${stamp(item.at)}`}
              >
                <span className="flex aspect-video items-center justify-center bg-[var(--letterbox)] text-3xl text-[var(--lamp)]">
                  ▶
                </span>
                <span className="mt-2 block text-xs text-[var(--cream)]">
                  {formatElapsed(item.durationMs)}
                </span>
                <span className="block text-[0.65rem] text-[var(--mist)]">
                  {stamp(item.at)} {item.loved ? "♥" : ""}
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  void love(item);
                }}
                aria-label={item.loved ? "Remove heart" : "Heart this recording"}
                className="absolute bottom-1 right-1 h-7 w-7 rounded-full bg-[var(--letterbox)] text-[var(--neon)]"
              >
                ♥
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenu({ item, confirming: false });
                }}
                aria-label={`More options for recording from ${stamp(item.at)}`}
                className="absolute right-1 top-1 h-7 w-7 rounded-full bg-[var(--letterbox)] text-[var(--cream)]"
              >
                …
              </button>
            </article>
          ))}
        </div>
      </div>
      {menu !== null ? (
        <div
          data-recording-menu
          role="menu"
          aria-label="Recording options"
          className="fixed bottom-5 left-1/2 z-20 w-64 -translate-x-1/2 border border-[var(--edge)] bg-[var(--letterbox)] p-2 shadow-[0_0_24px_var(--night)]"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void download(menu.item);
            }}
            className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--lamp)]/10"
          >
            Download
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              if (menu.confirming) {
                void remove(menu.item);
                return;
              }

              setMenu({ ...menu, confirming: true });
            }}
            className="block w-full px-3 py-2 text-left text-sm text-[var(--mist)] hover:bg-[var(--edge)]"
          >
            {menu.confirming ? "Delete recording" : "Delete"}
          </button>
        </div>
      ) : null}
      {busy !== null ? (
        <p className="mt-5 text-sm text-[var(--lamp)]">{busy}</p>
      ) : null}
      {error !== null ? (
        <p className="mt-5 text-sm text-[var(--neon)]">{error}</p>
      ) : null}
      {qr !== null ? (
        <div className="mt-5 flex flex-col items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- this is a browser-made QR data URL, not a fetchable image. */}
          <img
            src={qr}
            alt={link === null ? "QR code" : `QR code linking to ${link}`}
            width={QR_SIZE}
            height={QR_SIZE}
            className="bg-[var(--cream)] p-2"
          />
          <button
            type="button"
            onClick={() => {
              const item =
                items.find((entry) => entry.id === selected) ?? items[0];
              void localSave(item);
            }}
            className="text-sm text-[var(--lamp)] underline"
          >
            Save to this computer
          </button>
        </div>
      ) : null}
    </section>
  );
}
