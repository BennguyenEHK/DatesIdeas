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

/** The narrowest slice of navigator the platform question needs. */
export interface PlatformProbe {
  userAgent?: string;
  maxTouchPoints?: number;
}

/**
 * Whether this is a device whose photo library is reachable ONLY through the
 * share sheet — meaning an iPhone or an iPad.
 *
 * Everywhere else an ordinary download is the better answer, and on Android it
 * is the better answer twice over: the file lands in Downloads, the media
 * scanner indexes it, and it turns up in the gallery without anyone having to
 * pick an app out of a sheet. Apple has no equivalent. A download there goes to
 * Files, which is nowhere near Photos, so the sheet is not a worse route — it
 * is the only one.
 */
export function isApplePhotosDevice(probe?: PlatformProbe | null): boolean {
  let candidate: PlatformProbe | null | undefined = probe;
  if (candidate === undefined) {
    try {
      candidate = globalThis.navigator;
    } catch {
      return false;
    }
  }
  if (candidate == null) return false;

  const agent = typeof candidate.userAgent === "string" ? candidate.userAgent : "";
  if (/iPad|iPhone|iPod/.test(agent)) return true;
  // An iPad on iPadOS 13 and later calls itself a Macintosh. The touch points
  // are what give it away, and the distinction matters: a real Mac wants the
  // download, an iPad wants the sheet.
  const touches =
    typeof candidate.maxTouchPoints === "number" ? candidate.maxTouchPoints : 0;
  return /Macintosh/.test(agent) && touches > 1;
}

/** How this device should be offered a keepsake. */
export type SaveRoute = "share" | "download";

/**
 * Picks the route that actually ends with the file in someone's photos.
 *
 * The share sheet is not a nicer download; it is a different thing, and on
 * every platform but Apple's it is a chooser standing between a person and the
 * file they already asked for.
 */
export function saveRoute(
  canShareThisFile: boolean,
  probe?: PlatformProbe | null,
): SaveRoute {
  return canShareThisFile && isApplePhotosDevice(probe) ? "share" : "download";
}

/**
 * Saves bytes already in hand, under a name we choose.
 *
 * Deliberately built from the blob rather than by pointing a link at storage.
 * The bucket behind this app silently discards `response-content-disposition`
 * on a signed URL — measured, not assumed — so a remote link arrives with no
 * filename attached and the browser invents one, which is how a photo strip
 * ended up saved as something that was not a .png. A blob URL carries no
 * headers to be ignored: the `download` attribute is the whole filename, and
 * the type travels with the bytes.
 */
export function downloadBlob(
  blob: Blob,
  filename: string,
  doc?: Document | null,
): boolean {
  const target = doc === undefined ? globalThis.document : doc;
  if (target == null) return false;

  let href: string | null = null;
  try {
    href = URL.createObjectURL(blob);
    const anchor = target.createElement("a");
    anchor.href = href;
    anchor.download = filename;
    anchor.rel = "noopener";
    // In the document, because more than one browser ignores a click on an
    // anchor that was never attached to anything.
    target.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return true;
  } catch {
    return false;
  } finally {
    // Not on the next tick: some browsers have not started reading the blob by
    // then and the download arrives empty. A few seconds costs one object URL.
    if (href !== null) {
      const url = href;
      try {
        globalThis.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      } catch {
        URL.revokeObjectURL(url);
      }
    }
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
