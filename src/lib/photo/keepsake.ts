/** What kind of keepsake is being stored. */
export type KeepsakeKind = "strip" | "clip";

/** Largest upload allowed, per kind, in megabytes. */
export const MAX_UPLOAD_MB: Record<KeepsakeKind, number> = {
  strip: 8,
  clip: 40,
};

export const CONTENT_TYPE: Record<KeepsakeKind, string> = {
  strip: "image/png",
  clip: "video/mp4",
};

/** File extension for a kind, without the dot. */
export function extensionFor(
  kind: KeepsakeKind,
  mimeType?: string | null,
): string {
  if (kind === "strip") return "png";
  return mimeType?.toLowerCase().includes("mp4") === true ? "mp4" : "webm";
}

/**
 * Room and token are checked here because this string becomes a storage path;
 * accepting path punctuation would let a caller escape its room namespace.
 */
export function keepsakeKey(
  room: string,
  kind: KeepsakeKind,
  extension: string,
  token: string,
): string {
  if (room.length === 0 || token.length === 0) {
    throw new TypeError("room and token must not be empty");
  }
  if (!/^[A-Za-z0-9_-]+$/.test(room) || !/^[A-Za-z0-9_-]+$/.test(token)) {
    throw new TypeError("room and token contain invalid characters");
  }
  return `keepsakes/${room}/${kind}-${token}.${extension}`;
}

/** A short random token for a storage key. */
export function randomToken(bytes = 8): string {
  const count = Number.isFinite(bytes) && bytes >= 0 ? Math.floor(bytes) : 8;
  let values: Uint8Array;
  try {
    values = new Uint8Array(count);
  } catch {
    values = new Uint8Array(8);
  }

  try {
    const cryptoObject = globalThis.crypto;
    if (cryptoObject !== undefined) {
      cryptoObject.getRandomValues(values);
      return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
    }
  } catch {
    // Some browsers or test environments expose crypto but deny its method.
  }

  return Array.from(values, () => {
    try {
      return Math.floor(Math.random() * 256);
    } catch {
      return 0;
    }
  })
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export interface UploadTicket {
  /** Presigned PUT URL. Short-lived. */
  uploadUrl: string;
  /**
   * A short page on this app, and what the QR encodes.
   *
   * Deliberately not the signed storage link. That is six hundred-odd
   * characters, which makes a QR dense enough that a phone camera has to work
   * at it — and it would go stale in a few hours, whereas the page mints a
   * fresh one whenever somebody actually opens it. The page is also the only
   * place a phone can be offered its own "save to Photos", which a raw file
   * download can never reach.
   */
  shareUrl: string;
  key: string;
}

export interface UploadResult {
  ok: boolean;
  /** Present when ok. */
  url?: string;
  /** A short, human-readable reason when not ok. */
  error?: string;
}

function isUploadTicket(value: unknown): value is UploadTicket {
  if (typeof value !== "object" || value === null) return false;
  const ticket = value as Record<string, unknown>;
  return (
    typeof ticket.uploadUrl === "string" &&
    ticket.uploadUrl.length > 0 &&
    typeof ticket.shareUrl === "string" &&
    ticket.shareUrl.length > 0 &&
    typeof ticket.key === "string"
  );
}

/**
 * Ask the app only for a presigned ticket, then PUT the bytes directly to
 * storage because Vercel's serverless body limit cannot carry large live strips.
 */
/**
 * A media type without its parameters.
 *
 * MediaRecorder reports things like "video/mp4;codecs=avc1.42E01E", and the
 * codec detail is true but not something a storage service should be asked to
 * match on.
 */
export function baseMimeType(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const base = value.split(";")[0].trim().toLowerCase();
  return base === "" ? null : base;
}

export async function uploadKeepsake(
  blob: Blob,
  options: {
    room: string;
    kind: KeepsakeKind;
    mimeType?: string | null;
    /** Injected so this is testable; defaults to globalThis.fetch. */
    fetchImpl?: typeof fetch;
  },
): Promise<UploadResult> {
  try {
    if (blob.size === 0) return { ok: false, error: "nothing to send" };

    const limit = MAX_UPLOAD_MB[options.kind];
    const sizeMb = blob.size / (1024 * 1024);
    if (sizeMb > limit) {
      return {
        ok: false,
        error: `too big to send (${Math.ceil(sizeMb)}MB, limit ${limit}MB)`,
      };
    }

    const extension = extensionFor(options.kind, options.mimeType);
    // The recorder decides the format at runtime -- MP4 where the browser can
    // manage it, WebM otherwise -- so the type has to follow the actual bytes.
    // Declaring a fixed one here stored MP4 clips labelled as WebM, which is a
    // file a phone opens and then refuses to play.
    const contentType = baseMimeType(options.mimeType) ?? CONTENT_TYPE[options.kind];
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const ticketResponse = await fetchImpl("/api/keepsake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        room: options.room,
        kind: options.kind,
        contentType,
        extension,
        sizeBytes: blob.size,
      }),
    });

    if (!ticketResponse.ok) {
      if (ticketResponse.status === 410) {
        return { ok: false, error: "this room has closed" };
      }
      try {
        const body: unknown = await ticketResponse.json();
        if (typeof body === "object" && body !== null) {
          const error = (body as Record<string, unknown>).error;
          if (typeof error === "string" && error.length > 0) {
            return { ok: false, error };
          }
        }
      } catch {
        // A malformed error body still gets the stable client-facing message.
      }
      return { ok: false, error: "could not get an upload link" };
    }

    const ticketBody: unknown = await ticketResponse.json();
    if (!isUploadTicket(ticketBody)) {
      return { ok: false, error: "the upload link came back incomplete" };
    }

    const uploadResponse = await fetchImpl(ticketBody.uploadUrl, {
      method: "PUT",
      // Must match the type the URL was signed for, or storage rejects the PUT.
      headers: { "Content-Type": contentType },
      body: blob,
    });
    if (!uploadResponse.ok) return { ok: false, error: "the upload was refused" };

    return { ok: true, url: ticketBody.shareUrl };
  } catch {
    return { ok: false, error: "the upload could not finish" };
  }
}
