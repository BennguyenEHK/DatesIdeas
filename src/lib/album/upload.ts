import { localOffsetMinutes } from "@/lib/storage/datedName";
import { moves, type AlbumItem, type AlbumKind } from "./types";
import { allowsContentType, acceptsPoster, MAX_ALBUM_MB, withinCap } from "./keys";
import { stillFromImage } from "./poster";
import type { ConfirmRequest, ConfirmResponse, PresignRequest, PresignResponse } from "./wire";

export interface AlbumUploadResult {
  ok: boolean;
  item?: AlbumItem;
  error?: string;
}

/**
 * This browser's push device id, when it has one.
 *
 * Sent with the confirm so the server can leave this device out of the push it
 * is about to cause. Without it the phone you just took the photograph on
 * buzzes in your hand to tell you that you took a photograph.
 */
function deviceHeader(): Record<string, string> {
  try {
    const id = localStorage.getItem("festibooth.device");
    return id === null || id === "" ? {} : { "X-Device-Id": id };
  } catch {
    // A browser refusing storage simply gets told about its own snap.
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPresignResponse(value: unknown): value is PresignResponse {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" && typeof value.uploadUrl === "string" &&
    typeof value.happenedAt === "string" && typeof value.objectKey === "string" &&
    typeof value.receipt === "string" && typeof value.kind === "string"
  );
}

function isConfirmResponse(value: unknown): value is ConfirmResponse {
  return isRecord(value) && isRecord(value.item);
}

async function serverMessage(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && typeof body.error === "string" && body.error.length > 0) return body.error;
  } catch {
    // A broken error body must not hide the stable client-facing message.
  }
  return null;
}

async function httpError(response: Response, fallback: string): Promise<string> {
  // 401 is the one the server cannot phrase well, because it does not know
  // whether this is a new phone or a ticket that was rotated away. Everything
  // else the server says about itself is better than anything guessed here.
  if (response.status === 401) return "this device is not paired yet";
  // Pass the server's own message through whatever the status. It is written
  // for the person reading it -- "too large", "unsupported content type",
  // "sharing by QR is not set up" -- and replacing it with a generic line was
  // hiding the only sentence that said what to do about it. uploadKeepsake
  // already works this way; a sibling module should not answer differently.
  return (await serverMessage(response)) ?? fallback;
}

function happenedAt(value: string | Date | number | undefined): string {
  return new Date(value ?? Date.now()).toISOString();
}

function aborted(error: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true || (error instanceof DOMException && error.name === "AbortError");
}

async function putMain(
  fetchImpl: typeof fetch,
  url: string,
  file: Blob,
  contentType: string,
  signal: AbortSignal | undefined,
): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fetchImpl(url, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: file,
        signal,
      });
    } catch (error: unknown) {
      if (attempt === 1 || aborted(error, signal)) throw error;
    }
  }
  throw new Error("upload did not run");
}

/**
 * Presign, write directly to storage, then confirm the row. The row is last
 * because a failed storage PUT must not leave a visible album item behind.
 */
export async function addToAlbum(
  file: Blob,
  options: {
    kind: AlbumKind;
    contentType: string;
    happenedAt?: string | Date | number;
    sourceRoom?: string | null;
    poster?: Blob | null;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    onProgress?: (stage: "presigning" | "uploading" | "confirming") => void;
  },
): Promise<AlbumUploadResult> {
  if (file.size === 0) return { ok: false, error: "nothing to send" };
  if (!allowsContentType(options.kind, options.contentType)) {
    return { ok: false, error: `unsupported content type (${options.contentType})` };
  }
  const limit = MAX_ALBUM_MB[options.kind];
  const sizeMb = file.size / (1024 * 1024);
  if (!withinCap(options.kind, file.size)) {
    return { ok: false, error: `too big to send (${Math.ceil(sizeMb)}MB, limit ${limit}MB)` };
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const at = happenedAt(options.happenedAt);
  let poster = options.poster;
  if (poster === undefined && !moves(options.kind) && globalThis.document !== undefined) {
    try {
      poster = await stillFromImage(file);
    } catch {
      // Still generation is a convenience; an unsupported image must not stop
      // the original from being uploaded.
      poster = null;
    }
  }
  const withPoster = poster !== null && poster !== undefined && acceptsPoster(options.kind);
  const request: PresignRequest = {
    kind: options.kind,
    contentType: options.contentType,
    sizeBytes: file.size,
    happenedAt: at,
    withPoster,
    sourceRoom: options.sourceRoom,
    // This device's clock at the moment the memory happened, so the file is
    // named for that evening rather than for the same instant in UTC.
    utcOffsetMinutes: localOffsetMinutes(at),
  };

  try {
    options.onProgress?.("presigning");
    const presignResponse = await fetchImpl("/api/album", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: options.signal,
    });
    if (!presignResponse.ok) return { ok: false, error: await httpError(presignResponse, "could not get an upload link") };
    const presignBody: unknown = await presignResponse.json();
    if (!isPresignResponse(presignBody)) return { ok: false, error: "the upload link came back incomplete" };

    options.onProgress?.("uploading");
    const uploadResponse = await putMain(fetchImpl, presignBody.uploadUrl, file, options.contentType, options.signal);
    if (!uploadResponse.ok) return { ok: false, error: "the upload was refused" };

    let posterUploaded = false;
    if (poster !== null && poster !== undefined && presignBody.posterUploadUrl !== undefined) {
      try {
        const posterResponse = await fetchImpl(presignBody.posterUploadUrl, {
          method: "PUT",
          headers: { "Content-Type": "image/jpeg" },
          body: poster,
          signal: options.signal,
        });
        posterUploaded = posterResponse.ok;
      } catch {
        // A poster is a convenience thumbnail; the original remains valuable.
      }
    }

    options.onProgress?.("confirming");
    const confirm: ConfirmRequest = {
      id: presignBody.id,
      objectKey: presignBody.objectKey,
      receipt: presignBody.receipt,
      kind: presignBody.kind,
      contentType: options.contentType,
      sizeBytes: file.size,
      happenedAt: presignBody.happenedAt,
      sourceRoom: options.sourceRoom,
      posterUploaded,
    };
    const confirmResponse = await fetchImpl("/api/album", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...deviceHeader() },
      body: JSON.stringify(confirm),
      signal: options.signal,
    });
    if (!confirmResponse.ok) return { ok: false, error: await httpError(confirmResponse, "could not confirm the upload") };
    const confirmBody: unknown = await confirmResponse.json();
    if (!isConfirmResponse(confirmBody)) return { ok: false, error: "the album item came back incomplete" };
    return { ok: true, item: confirmBody.item };
  } catch {
    return { ok: false, error: "the upload could not finish" };
  }
}
