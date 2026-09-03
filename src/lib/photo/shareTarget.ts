/** The narrowest slice of navigator this module needs, so it is testable. */
export interface ShareCapable {
  share?: (data: { files?: File[]; title?: string; text?: string }) => Promise<void>;
  canShare?: (data: { files?: File[] }) => boolean;
}

/**
 * Checks the file-specific capability before showing a share button. A
 * browser may expose share() for links while rejecting files, and it may
 * accept one file type while rejecting another.
 */
export function canShareFiles(
  nav?: ShareCapable | null,
  probe?: File | null,
): boolean {
  let candidate: ShareCapable | null | undefined = nav;
  if (candidate === undefined) {
    try {
      candidate = globalThis.navigator;
    } catch {
      return false;
    }
  }

  if (
    candidate == null ||
    typeof candidate.share !== "function" ||
    typeof candidate.canShare !== "function"
  ) {
    return false;
  }

  if (probe === undefined || probe === null) return true;

  try {
    return candidate.canShare({ files: [probe] }) === true;
  } catch {
    return false;
  }
}

export type ShareOutcome = "shared" | "dismissed" | "unsupported" | "failed";

/**
 * Offers a file to the operating system, keeping browser refusal a normal
 * outcome because callers can then fall back to an ordinary download.
 */
export async function shareFile(
  file: File,
  options?: { title?: string; nav?: ShareCapable | null },
): Promise<ShareOutcome> {
  const nav = options?.nav;
  if (!canShareFiles(nav, file)) return "unsupported";

  try {
    const data =
      options?.title === undefined
        ? { files: [file] }
        : { files: [file], title: options.title };
    const candidate = (nav === undefined ? globalThis.navigator : nav) as ShareCapable;
    await candidate.share?.(data);
    return "shared";
  } catch (error: unknown) {
    // AbortError means the person dismissed the sheet; it is not a failure.
    if (
      typeof error === "object" &&
      error !== null &&
      "name" in error &&
      (error as { name?: unknown }).name === "AbortError"
    ) {
      return "dismissed";
    }
    return "failed";
  }
}

/** Builds a safe, platform-friendly File name from downloaded bytes. */
export function fileFromBlob(blob: Blob, name: string, type?: string): File {
  const contentType = type || blob.type || "application/octet-stream";
  const stripped = name.replace(/[^A-Za-z0-9._-]/g, "").replace(/\.+/g, ".");
  const safeName = /[A-Za-z0-9_-]/.test(stripped) ? stripped : "festibooth";
  return new File([blob], safeName, { type: contentType });
}

/** A friendly filename for a keepsake. */
export function keepsakeFilename(
  kind: "strip" | "clip",
  mimeType: string | null | undefined,
  room?: string | null,
): string {
  const roomSegment =
    typeof room === "string" && /^[A-Za-z0-9_-]+$/.test(room) ? `-${room}` : "";
  if (kind === "strip") return `festibooth${roomSegment}.png`;

  const extension = mimeType?.toLowerCase().includes("mp4") === true ? "mp4" : "webm";
  return `festibooth${roomSegment}-live.${extension}`;
}
