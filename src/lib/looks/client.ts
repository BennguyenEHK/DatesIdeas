import {
  isCustomLook,
  LOOK_LAYER_MAX_BYTES,
  LOOK_SOURCE_MAX_BYTES,
  LOOK_SOURCE_TYPES,
  type LookSource,
  type LooksClient,
} from "./types";

type FetchImpl = typeof fetch;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function errorFor(response: Response, fallback: string): Promise<string> {
  if (response.status === 401) return "Pair this device to keep designed looks.";
  try {
    const body = record(await response.json());
    if (typeof body?.error === "string" && body.error.length > 0) return body.error;
  } catch {
    // A non-JSON proxy error still deserves a stable sentence.
  }
  return fallback;
}

function source(value: unknown): LookSource | null {
  const body = record(value);
  return typeof body?.key === "string" && typeof body.url === "string"
    ? { key: body.key, url: body.url }
    : null;
}

/** Browser transport for the looks contract. It never lets a fetch failure escape a screen. */
export function createLooksClient(fetchImpl: FetchImpl = globalThis.fetch): LooksClient {
  return {
    async list() {
      try {
        const response = await fetchImpl("/api/looks");
        if (!response.ok)
          return { ok: false as const, error: await errorFor(response, "Could not load designed looks.") };
        const body = record(await response.json());
        if (!Array.isArray(body?.looks) || !body.looks.every(isCustomLook)) {
          return { ok: false as const, error: "Designed looks came back incomplete." };
        }
        return { ok: true as const, looks: body.looks };
      } catch {
        return { ok: false as const, error: "Could not load designed looks." };
      }
    },

    async save(input) {
      if (input.backdrop.size > LOOK_LAYER_MAX_BYTES || input.overlay.size > LOOK_LAYER_MAX_BYTES) {
        return { ok: false as const, error: "Each look layer must be 8MB or smaller." };
      }
      try {
        const presign = await fetchImpl("/api/looks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: input.name,
            shots: input.shots,
            ink: input.ink,
            backdropBytes: input.backdrop.size,
            overlayBytes: input.overlay.size,
          }),
        });
        if (!presign.ok)
          return { ok: false as const, error: await errorFor(presign, "Could not prepare this look.") };
        const ticket = record(await presign.json());
        if (
          typeof ticket?.id !== "string" ||
          typeof ticket.receipt !== "string" ||
          typeof ticket.backdropKey !== "string" ||
          typeof ticket.overlayKey !== "string" ||
          typeof ticket.backdropUploadUrl !== "string" ||
          typeof ticket.overlayUploadUrl !== "string"
        )
          return { ok: false as const, error: "The look upload link came back incomplete." };

        const [backdrop, overlay] = await Promise.all([
          fetchImpl(ticket.backdropUploadUrl, {
            method: "PUT",
            headers: { "Content-Type": "image/png" },
            body: input.backdrop,
          }),
          fetchImpl(ticket.overlayUploadUrl, {
            method: "PUT",
            headers: { "Content-Type": "image/png" },
            body: input.overlay,
          }),
        ]);
        if (!backdrop.ok || !overlay.ok)
          return { ok: false as const, error: "The look layers could not be uploaded." };

        const confirmed = await fetchImpl("/api/looks", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: ticket.id,
            receipt: ticket.receipt,
            name: input.name,
            shots: input.shots,
            ink: input.ink,
          }),
        });
        if (!confirmed.ok)
          return { ok: false as const, error: await errorFor(confirmed, "Could not save this look.") };
        const body = record(await confirmed.json());
        if (!isCustomLook(body?.look))
          return { ok: false as const, error: "The saved look came back incomplete." };
        return { ok: true as const, look: body.look };
      } catch {
        return { ok: false as const, error: "The look could not be saved." };
      }
    },

    async remove(id) {
      try {
        const response = await fetchImpl(`/api/looks/${encodeURIComponent(id)}`, { method: "DELETE" });
        return response.ok
          ? { ok: true }
          : { ok: false, error: await errorFor(response, "Could not remove this look.") };
      } catch {
        return { ok: false, error: "Could not remove this look." };
      }
    },

    async uploadSource(file) {
      if (!LOOK_SOURCE_TYPES.includes(file.type as (typeof LOOK_SOURCE_TYPES)[number])) {
        return { ok: false as const, error: "Use a JPEG, PNG, or WebP picture." };
      }
      if (file.size <= 0 || file.size > LOOK_SOURCE_MAX_BYTES) {
        return { ok: false as const, error: "Source pictures must be 12MB or smaller." };
      }
      try {
        const presign = await fetchImpl("/api/looks/sources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentType: file.type, sizeBytes: file.size }),
        });
        if (!presign.ok)
          return { ok: false as const, error: await errorFor(presign, "Could not prepare this picture.") };
        const ticket = record(await presign.json());
        if (
          typeof ticket?.key !== "string" ||
          typeof ticket.uploadUrl !== "string" ||
          typeof ticket.url !== "string"
        ) {
          return { ok: false as const, error: "The picture upload link came back incomplete." };
        }
        const uploaded = await fetchImpl(ticket.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });
        return uploaded.ok
          ? { ok: true as const, source: { key: ticket.key, url: ticket.url } }
          : { ok: false as const, error: "The picture could not be uploaded." };
      } catch {
        return { ok: false as const, error: "The picture could not be uploaded." };
      }
    },

    async sourceUrl(key) {
      try {
        const response = await fetchImpl(`/api/looks/sources?key=${encodeURIComponent(key)}`);
        if (!response.ok)
          return { ok: false as const, error: await errorFor(response, "Could not open this picture.") };
        const value = source(await response.json());
        return value === null
          ? { ok: false as const, error: "The picture link came back incomplete." }
          : { ok: true as const, source: value };
      } catch {
        return { ok: false as const, error: "Could not open this picture." };
      }
    },
  };
}

export const looksClient = createLooksClient();
