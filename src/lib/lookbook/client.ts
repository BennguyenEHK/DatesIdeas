import type { LookbookClient, LookbookResult } from "./contract";
import {
  isLookbookPiece,
  isOutfit,
  type LookbookPiece,
  type Outfit,
  type PieceContentType,
} from "./types";

type FetchImpl = typeof fetch;
type Shrink = (file: Blob) => Promise<Blob>;
const MAX_EDGE = 1600;
const SMALL_ENOUGH_BYTES = 1.5 * 1024 * 1024;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function errorFor(response: Response, fallback: string): Promise<string> {
  if (response.status === 401) return "this device is not paired yet";
  try {
    const body = record(await response.json());
    if (typeof body?.error === "string" && body.error !== "") return body.error;
  } catch {
    // Proxies sometimes replace an API error with an HTML page.
  }
  return fallback;
}

function validGrant(
  value: unknown,
): value is { id: string; key: string; uploadUrl: string; receipt: string } {
  const grant = record(value);
  return (
    typeof grant?.id === "string" &&
    typeof grant.key === "string" &&
    typeof grant.uploadUrl === "string" &&
    typeof grant.receipt === "string"
  );
}

async function shrinkImage(file: Blob): Promise<Blob> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;
  try {
    const bitmap = await createImageBitmap(file);
    if (Math.max(bitmap.width, bitmap.height) <= MAX_EDGE && file.size <= SMALL_ENOUGH_BYTES) {
      bitmap.close();
      return file;
    }
    const scale = MAX_EDGE / Math.max(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (context === null) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const result = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.82),
    );
    return result ?? file;
  } catch {
    return file;
  }
}

function contentType(file: Blob): PieceContentType | null {
  return file.type === "image/jpeg" || file.type === "image/png" || file.type === "image/webp"
    ? file.type
    : null;
}

/** Browser transport for the Lookbook API; failures always become screen-safe results. */
export function createLookbookClient(
  options: { fetchImpl?: FetchImpl; shrink?: Shrink } = {},
): LookbookClient {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const request = async <T>(
    url: string,
    init: RequestInit | undefined,
    validate: (body: unknown) => T | null,
    fallback: string,
  ): Promise<LookbookResult<T>> => {
    try {
      const response = await fetchImpl(url, init);
      if (!response.ok)
        return { ok: false, status: response.status, error: await errorFor(response, fallback) };
      const value = validate(await response.json());
      return value === null
        ? { ok: false, status: response.status, error: "the server response was incomplete" }
        : { ok: true, value };
    } catch {
      return { ok: false, status: null, error: fallback };
    }
  };
  const piece = (value: unknown): LookbookPiece | null => {
    const body = record(value);
    return isLookbookPiece(body?.piece) ? body.piece : null;
  };
  const outfit = (value: unknown): Outfit | null => {
    const body = record(value);
    return isOutfit(body?.outfit) ? body.outfit : null;
  };

  return {
    listPieces: () =>
      request(
        "/api/lookbook/pieces",
        undefined,
        (value) => {
          const body = record(value);
          return Array.isArray(body?.pieces) && body.pieces.every(isLookbookPiece)
            ? body.pieces
            : null;
        },
        "could not load the wardrobe",
      ),
    async addPiece(file, fields) {
      try {
        const prepared = await (options.shrink ?? shrinkImage)(file);
        const type = contentType(prepared);
        if (type === null)
          return { ok: false, status: null, error: "use a JPEG, PNG, or WebP picture" };
        const presign = await fetchImpl("/api/lookbook/pieces", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentType: type, bytes: prepared.size }),
        });
        if (!presign.ok)
          return {
            ok: false,
            status: presign.status,
            error: await errorFor(presign, "could not prepare the picture"),
          };
        const grant = await presign.json();
        if (!validGrant(grant))
          return {
            ok: false,
            status: presign.status,
            error: "the upload link came back incomplete",
          };
        const uploaded = await fetchImpl(grant.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": type },
          body: prepared,
        });
        if (!uploaded.ok)
          return { ok: false, status: uploaded.status, error: "the picture could not be uploaded" };
        return request(
          "/api/lookbook/pieces",
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...fields,
              id: grant.id,
              key: grant.key,
              contentType: type,
              bytes: prepared.size,
              receipt: grant.receipt,
            }),
          },
          piece,
          "could not save the picture",
        );
      } catch {
        return { ok: false, status: null, error: "the picture could not be uploaded" };
      }
    },
    updatePiece: (id, patch) =>
      request(
        `/api/lookbook/pieces/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        },
        piece,
        "could not update the piece",
      ),
    deletePiece: (id) =>
      request(
        `/api/lookbook/pieces/${encodeURIComponent(id)}`,
        { method: "DELETE" },
        (value) => {
          const body = record(value);
          return body?.ok === true ? true : null;
        },
        "could not delete the piece",
      ),
    listOutfits: (range) => {
      const query =
        range === undefined
          ? ""
          : `?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
      return request(
        `/api/lookbook/outfits${query}`,
        undefined,
        (value) => {
          const body = record(value);
          return Array.isArray(body?.outfits) && body.outfits.every(isOutfit) ? body.outfits : null;
        },
        "could not load outfits",
      );
    },
    createOutfit: (fields) =>
      request(
        "/api/lookbook/outfits",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(fields),
        },
        outfit,
        "could not create the outfit",
      ),
    updateOutfit: (id, patch) =>
      request(
        `/api/lookbook/outfits/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        },
        outfit,
        "could not update the outfit",
      ),
    deleteOutfit: (id) =>
      request(
        `/api/lookbook/outfits/${encodeURIComponent(id)}`,
        { method: "DELETE" },
        (value) => {
          const body = record(value);
          return body?.ok === true ? true : null;
        },
        "could not delete the outfit",
      ),
  };
}

export const lookbookClient = createLookbookClient();
