"use client";

import { useEffect, useState } from "react";
import { qrDataUrl } from "@/lib/photo/qr";

/**
 * The season ticket, as something another device can scan.
 *
 * The same `qrDataUrl` the photo booth uses, pointed at a different kind of
 * link -- and this one deserves more care than a keepsake does. A keepsake QR
 * opens one photograph for one day. This one opens the whole album, forever,
 * to whoever reads it.
 *
 * So it is never on screen by default. It is behind a press, it says what it
 * is, and it hides itself again. An app with a record button must not leave
 * its own master key sitting in the background of a recording.
 */
export function TicketQR({ url, autoShow = false }: { url: string; autoShow?: boolean }) {
  const [shown, setShown] = useState(autoShow);

  if (!shown) {
    return (
      <button
        type="button"
        onClick={() => setShown(true)}
        className="inline-flex items-center gap-2 rounded-full px-4 py-2 font-sans text-xs tracking-wide text-[var(--lamp)] ring-1 ring-[var(--lamp)]/40 transition-colors hover:bg-[var(--lamp)]/10"
      >
        Show the ticket
      </button>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <QRImage url={url} />
      <p className="max-w-[15rem] text-center font-sans text-[11px] leading-relaxed text-[var(--mist)]">
        Anyone who scans this can open your album for good. Show it to K&rsquo;s
        phone and nothing else.
      </p>
      <button
        type="button"
        onClick={() => setShown(false)}
        className="font-sans text-[11px] tracking-wide text-[var(--mist)] underline underline-offset-4 transition-colors hover:text-[var(--cream)]"
      >
        Hide it
      </button>
    </div>
  );
}

/**
 * The code itself, in a component that exists only while it is on screen.
 *
 * Separated so that hiding the ticket UNMOUNTS this, which is what actually
 * drops the data URL. Keeping one component and clearing its state in an
 * effect looked equivalent and was not: it left the generated ticket sitting
 * in a closure, and it made the effect fight its own render.
 */
function QRImage({ url }: { url: string }) {
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void qrDataUrl(url).then((generated) => {
      if (!cancelled) setCode(generated);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <div className="rounded-lg bg-[#f5efe0] p-3">
      {code === null ? (
        <div className="h-44 w-44 rounded bg-[#e2d9c4]" aria-label="Drawing the code" />
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element -- a data: URL
           generated in this browser; there is nothing for the optimiser to
           fetch, and routing it through one would upload the ticket. */
        <img src={code} alt="Scan to open the album on another device" width={176} height={176} />
      )}
    </div>
  );
}
