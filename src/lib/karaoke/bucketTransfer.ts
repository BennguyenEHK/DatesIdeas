/**
 * Moves a karaoke song through the storage bucket instead of the call.
 *
 * The peer-to-peer path shares the call's uplink, so on a lossy connection it
 * is held for minutes. The bucket is a second road that does not compete with
 * the call: the sender PUTs the song once, and the other side GETs it over
 * plain HTTPS. Everything here is a plain function that never throws -- a
 * failure is a null/false the caller turns into the peer-to-peer fallback.
 */

/** A signed pair for one song: where to PUT it, and where the other side GETs it. */
export interface TrackSlot {
  uploadUrl: string;
  downloadUrl: string;
}

export interface BucketDeps {
  fetch?: typeof fetch;
  /** Builds the request used for uploads, so tests can stand in for it. */
  xhr?: () => XMLHttpRequest;
}

// The presigned URL is signed for exactly this type; any other Content-Type on
// the PUT makes the bucket reject the signature.
const TRACK_CONTENT_TYPE = "video/mp4";

const UPLOAD_ATTEMPTS = 3;
const DOWNLOAD_PARTS = 4;
const DOWNLOAD_ATTEMPTS = 4;

// A stalled upload has to give up eventually, but a slow honest one must not.
// 32 KB/s is slower than any connection worth waiting for; the floor keeps a
// tiny file from timing out during a brief stall.
const UPLOAD_MIN_TIMEOUT_MS = 60_000;
const UPLOAD_SLOWEST_BYTES_PER_SEC = 32 * 1024;

// Below this size a part costs more in request overhead than it saves.
const MIN_PART_BYTES = 256 * 1024;
const PROGRESS_INTERVAL_MS = 100;
const RETRY_BASE_MS = 1000;

/** 1 s after the first failure, then 2 s, 4 s: a flaky link gets room to heal. */
function retryDelayMs(failures: number): number {
  return RETRY_BASE_MS * 2 ** (failures - 1);
}

/** Waits, but returns early once `signal` aborts so a cancelled job ends at once. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener("abort", finish);
  });
}

/** Asks the server for a slot in karaoke/<room>/, or null when there is none. */
export async function requestTrackSlot(
  roomCode: string,
  bytes: number,
  deps: BucketDeps = {},
): Promise<TrackSlot | null> {
  try {
    const doFetch = deps.fetch ?? fetch;
    const res = await doFetch("/api/karaoke/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: roomCode,
        bytes,
        contentType: TRACK_CONTENT_TYPE,
      }),
    });
    if (res.status !== 200) return null;
    const body: unknown = await res.json();
    if (typeof body !== "object" || body === null) return null;
    const { uploadUrl, downloadUrl } = body as Record<string, unknown>;
    if (typeof uploadUrl !== "string" || typeof downloadUrl !== "string") {
      return null;
    }
    if (!uploadUrl || !downloadUrl) return null;
    return { uploadUrl, downloadUrl };
  } catch {
    return null;
  }
}

/**
 * One PUT. XMLHttpRequest rather than fetch because only XHR reports how many
 * bytes have left the machine (xhr.upload.onprogress); fetch has no upload
 * progress, and the other person's progress bar is driven by this number.
 */
function putOnce(
  uploadUrl: string,
  media: ArrayBuffer,
  report: (loaded: number) => void,
  makeXhr: () => XMLHttpRequest,
): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const xhr = makeXhr();
      xhr.open("PUT", uploadUrl);
      xhr.setRequestHeader("Content-Type", TRACK_CONTENT_TYPE);
      xhr.timeout = Math.max(
        UPLOAD_MIN_TIMEOUT_MS,
        (media.byteLength / UPLOAD_SLOWEST_BYTES_PER_SEC) * 1000,
      );
      xhr.upload.onprogress = (event) => report(event.loaded);
      xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
      xhr.onerror = () => resolve(false);
      xhr.ontimeout = () => resolve(false);
      xhr.onabort = () => resolve(false);
      xhr.send(media);
    } catch {
      resolve(false);
    }
  });
}

/** Uploads the song with progress, retrying; true once the bucket has all of it. */
export async function uploadTrack(
  uploadUrl: string,
  media: ArrayBuffer,
  onProgress: (sentBytes: number) => void,
  deps: BucketDeps & { attempts?: number } = {},
): Promise<boolean> {
  const attempts = deps.attempts ?? UPLOAD_ATTEMPTS;
  const makeXhr = deps.xhr ?? (() => new XMLHttpRequest());

  // A retry restarts the PUT from byte 0, so its progress starts low again.
  // The bar on the other side must never run backwards, so only a new high is
  // ever reported.
  let reported = 0;
  const report = (loaded: number) => {
    if (loaded > reported) {
      reported = loaded;
      onProgress(loaded);
    }
  };

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (await putOnce(uploadUrl, media, report, makeXhr)) {
      report(media.byteLength);
      return true;
    }
    if (attempt < attempts) await sleep(retryDelayMs(attempt));
  }
  return false;
}

interface PartRange {
  start: number;
  /** Inclusive, as in an HTTP Range header. */
  end: number;
}

/** Splits [0, bytes) into contiguous ranges of at least MIN_PART_BYTES each. */
function splitRanges(bytes: number, parts: number): PartRange[] {
  const count = Math.max(
    1,
    Math.min(Math.floor(parts), Math.floor(bytes / MIN_PART_BYTES)),
  );
  const size = Math.floor(bytes / count);
  const ranges: PartRange[] = [];
  for (let i = 0; i < count; i++) {
    const start = i * size;
    // The last part takes the remainder so the ranges cover every byte.
    const end = i === count - 1 ? bytes - 1 : start + size - 1;
    ranges.push({ start, end });
  }
  return ranges;
}

/**
 * Downloads the song in parallel ranged parts with progress, each part
 * resuming from where it stopped; null when it could not be fetched whole.
 *
 * Ranges because one HTTP stream rarely fills a good link, while several in
 * parallel do. Per-part resume because a drop near the end of a 60 MB song
 * should cost the seconds since the drop, not the whole song: a failed part
 * asks again for only the bytes it is missing.
 */
export async function downloadTrack(
  downloadUrl: string,
  bytes: number,
  onProgress: (receivedBytes: number) => void,
  deps: BucketDeps & { parts?: number; attempts?: number } = {},
): Promise<ArrayBuffer | null> {
  if (!Number.isInteger(bytes) || bytes <= 0) return null;
  const attempts = deps.attempts ?? DOWNLOAD_ATTEMPTS;
  const doFetch = deps.fetch ?? fetch;

  try {
    const ranges = splitRanges(bytes, deps.parts ?? DOWNLOAD_PARTS);
    // Every part copies straight into its slot of one buffer, so assembling
    // the song is free and order is guaranteed by the offsets.
    const out = new Uint8Array(bytes);
    const received = ranges.map(() => 0);
    const controller = new AbortController();
    const { signal } = controller;

    let lastReportAt = Number.NEGATIVE_INFINITY;
    const report = (force: boolean) => {
      const now = Date.now();
      if (!force && now - lastReportAt < PROGRESS_INTERVAL_MS) return;
      lastReportAt = now;
      onProgress(received.reduce((sum, n) => sum + n, 0));
    };

    /** One try at the rest of a part; true once the part is complete. */
    const tryPart = async (index: number): Promise<boolean> => {
      const { start, end } = ranges[index];
      const from = start + received[index];
      // A server that ignores Range answers 200 with the whole file. That is
      // only usable when the whole file is what was asked for; for a partial
      // request it would put the wrong bytes at this offset.
      const wholeFile = from === 0 && end === bytes - 1;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const res = await doFetch(downloadUrl, {
          headers: { Range: `bytes=${from}-${end}` },
          signal,
        });
        const usable = res.status === 206 || (res.status === 200 && wholeFile);
        if (!usable || !res.body) return false;
        reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          const offset = start + received[index];
          const room = end + 1 - offset;
          if (room <= 0) break;
          const chunk =
            value.byteLength > room ? value.subarray(0, room) : value;
          out.set(chunk, offset);
          received[index] += chunk.byteLength;
          report(false);
        }
        // A body that ended early is a failed try, resumed from `received`.
        return start + received[index] === end + 1;
      } catch {
        return false;
      } finally {
        reader?.cancel().catch(() => {});
      }
    };

    const runPart = async (index: number): Promise<boolean> => {
      for (let attempt = 1; attempt <= attempts; attempt++) {
        if (signal.aborted) return false;
        if (await tryPart(index)) return true;
        if (attempt < attempts) await sleep(retryDelayMs(attempt), signal);
      }
      // The song is useless without this part, so stop the others from
      // spending bandwidth the peer-to-peer fallback now needs.
      controller.abort();
      return false;
    };

    const results = await Promise.all(ranges.map((_, i) => runPart(i)));
    if (!results.every(Boolean)) return null;
    const total = received.reduce((sum, n) => sum + n, 0);
    if (total !== bytes) return null;
    report(true);
    return out.buffer as ArrayBuffer;
  } catch {
    return null;
  }
}
