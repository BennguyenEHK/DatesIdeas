import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadTrack, requestTrackSlot, uploadTrack } from "./bucketTransfer";

const MIB = 1024 * 1024;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response;
}

describe("requestTrackSlot", () => {
  it("returns both URLs on 200, null on 503, null on a network error", async () => {
    const ok = vi.fn(async () =>
      jsonResponse(200, {
        uploadUrl: "https://bucket/put",
        downloadUrl: "https://bucket/get",
        key: "karaoke/ABCD/x.mp4",
      }),
    );
    const slot = await requestTrackSlot("ABCD", 1234, {
      fetch: ok as unknown as typeof fetch,
    });
    expect(slot).toEqual({
      uploadUrl: "https://bucket/put",
      downloadUrl: "https://bucket/get",
    });
    const [url, init] = ok.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/karaoke/track");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      code: "ABCD",
      bytes: 1234,
      contentType: "video/mp4",
    });

    const unavailable = vi.fn(async () => jsonResponse(503, { error: "no" }));
    expect(
      await requestTrackSlot("ABCD", 1234, {
        fetch: unavailable as unknown as typeof fetch,
      }),
    ).toBeNull();

    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(
      await requestTrackSlot("ABCD", 1234, {
        fetch: offline as unknown as typeof fetch,
      }),
    ).toBeNull();
  });
});

type XhrScript = (xhr: FakeXhr) => void;

/** Just enough of XMLHttpRequest for uploadTrack; a script decides each outcome. */
class FakeXhr {
  method = "";
  url = "";
  timeout = 0;
  status = 0;
  headers: Record<string, string> = {};
  sent: unknown = null;
  upload: { onprogress: ((e: { loaded: number }) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;

  constructor(private readonly script: XhrScript) {}

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.sent = body;
    queueMicrotask(() => this.script(this));
  }
  progress(loaded: number) {
    this.upload.onprogress?.({ loaded });
  }
  finish(status: number) {
    this.status = status;
    this.onload?.();
  }
}

function xhrFactory(scripts: XhrScript[]) {
  const made: FakeXhr[] = [];
  const make = () => {
    const script = scripts[made.length] ?? ((x: FakeXhr) => x.onerror?.());
    const xhr = new FakeXhr(script);
    made.push(xhr);
    return xhr as unknown as XMLHttpRequest;
  };
  return { make, made };
}

describe("uploadTrack", () => {
  it("reports progress and resolves true on a 2xx", async () => {
    const media = new ArrayBuffer(1000);
    const { make, made } = xhrFactory([
      (x) => {
        x.progress(400);
        x.progress(1000);
        x.finish(200);
      },
    ]);
    const seen: number[] = [];
    const ok = await uploadTrack(
      "https://bucket/put",
      media,
      (n) => seen.push(n),
      {
        xhr: make,
      },
    );

    expect(ok).toBe(true);
    expect(seen).toEqual([400, 1000]);
    expect(made).toHaveLength(1);
    expect(made[0].method).toBe("PUT");
    expect(made[0].url).toBe("https://bucket/put");
    expect(made[0].headers["Content-Type"]).toBe("video/mp4");
    expect(made[0].sent).toBe(media);
    // Small file: the floor applies, so a short stall does not end the upload.
    expect(made[0].timeout).toBe(60_000);
  });

  it("retries after an error and succeeds on the second try, never reporting less", async () => {
    const { make, made } = xhrFactory([
      (x) => {
        x.progress(500);
        x.onerror?.();
      },
      (x) => {
        x.progress(300);
        x.progress(1000);
        x.finish(200);
      },
    ]);
    const seen: number[] = [];
    const promise = uploadTrack(
      "https://bucket/put",
      new ArrayBuffer(1000),
      (n) => seen.push(n),
      { xhr: make },
    );

    await vi.advanceTimersByTimeAsync(999);
    expect(made).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await promise).toBe(true);
    expect(made).toHaveLength(2);
    // The second try restarted at 300, below the 500 already reported.
    expect(seen).toEqual([500, 1000]);
  });

  it("gives up after 3 failed tries and returns false", async () => {
    const { make, made } = xhrFactory([
      (x) => x.onerror?.(),
      (x) => x.finish(500),
      (x) => x.ontimeout?.(),
      (x) => x.finish(200),
    ]);
    const promise = uploadTrack(
      "https://bucket/put",
      new ArrayBuffer(10),
      () => {},
      {
        xhr: make,
      },
    );

    await vi.advanceTimersByTimeAsync(1000);
    expect(made).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await promise).toBe(false);
    // Three tries in all; the scripted fourth success is never used.
    expect(made).toHaveLength(3);
  });
});

function makeSource(size: number): Uint8Array {
  const data = new Uint8Array(size);
  for (let i = 0; i < size; i++) data[i] = (i * 7 + 3) % 251;
  return data;
}

type RangeBehavior =
  "ok" | "hang" | { status: number } | { truncateAt: number };

interface RecordedRequest {
  range: string;
  signal: AbortSignal;
}

/** A fetch that serves Range requests from `source`, with scripted misbehaviour. */
function rangeFetch(
  source: Uint8Array,
  options: {
    chunk?: number;
    tickMs?: number;
    behave?: (range: string, tryNumber: number) => RangeBehavior;
  } = {},
) {
  const requests: RecordedRequest[] = [];
  const tries = new Map<string, number>();
  const chunk = options.chunk ?? 64 * 1024;

  const fn = vi.fn(async (_url: string, init: RequestInit) => {
    const range = (init.headers as Record<string, string>).Range;
    const signal = init.signal as AbortSignal;
    requests.push({ range, signal });
    const tryNumber = (tries.get(range) ?? 0) + 1;
    tries.set(range, tryNumber);

    const behavior = options.behave?.(range, tryNumber) ?? "ok";
    if (behavior === "hang") {
      return new Promise<Response>((_, reject) => {
        signal.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    }
    if (typeof behavior === "object" && "status" in behavior) {
      return { status: behavior.status, body: null } as unknown as Response;
    }

    const match = /^bytes=(\d+)-(\d+)$/.exec(range);
    if (!match) throw new Error(`unexpected Range ${range}`);
    const start = Number(match[1]);
    const end = Number(match[2]);
    let data = source.slice(start, end + 1);
    if (typeof behavior === "object" && "truncateAt" in behavior) {
      data = data.slice(0, behavior.truncateAt);
    }
    let pos = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pos >= data.length) {
          controller.close();
          return;
        }
        controller.enqueue(data.slice(pos, pos + chunk));
        pos += chunk;
        // Lets the throttled progress see time passing between chunks.
        if (options.tickMs) vi.setSystemTime(Date.now() + options.tickMs);
      },
    });
    return { status: 206, body } as unknown as Response;
  });

  return { fetch: fn as unknown as typeof fetch, requests };
}

describe("downloadTrack", () => {
  it("splits into 4 ranges with the right Range headers and assembles bytes in order", async () => {
    const source = makeSource(4 * MIB);
    const { fetch: fakeFetch, requests } = rangeFetch(source);

    const promise = downloadTrack(
      "https://bucket/get",
      source.length,
      () => {},
      {
        fetch: fakeFetch,
      },
    );
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;

    expect(requests.map((r) => r.range).sort()).toEqual(
      [
        `bytes=0-${MIB - 1}`,
        `bytes=${MIB}-${2 * MIB - 1}`,
        `bytes=${2 * MIB}-${3 * MIB - 1}`,
        `bytes=${3 * MIB}-${4 * MIB - 1}`,
      ].sort(),
    );
    expect(result).not.toBeNull();
    expect(result!.byteLength).toBe(source.length);
    expect(Buffer.from(result!).equals(Buffer.from(source))).toBe(true);
  });

  it("resumes a part that ends early from its own offset with a narrower Range", async () => {
    const source = makeSource(4 * MIB);
    const secondPart = `bytes=${MIB}-${2 * MIB - 1}`;
    const { fetch: fakeFetch, requests } = rangeFetch(source, {
      behave: (range, tryNumber) =>
        range === secondPart && tryNumber === 1
          ? { truncateAt: 300_000 }
          : "ok",
    });

    const promise = downloadTrack(
      "https://bucket/get",
      source.length,
      () => {},
      {
        fetch: fakeFetch,
      },
    );
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    const ranges = requests.map((r) => r.range);
    // Only the second part asked twice, and the retry skipped the 300000 bytes it kept.
    expect(ranges).toHaveLength(5);
    expect(ranges).toContain(secondPart);
    expect(ranges).toContain(`bytes=${MIB + 300_000}-${2 * MIB - 1}`);
    expect(result).not.toBeNull();
    expect(Buffer.from(result!).equals(Buffer.from(source))).toBe(true);
  });

  it("returns null when a part fails every try, and aborts the others", async () => {
    const source = makeSource(4 * MIB);
    const badPart = `bytes=${2 * MIB}-${3 * MIB - 1}`;
    const { fetch: fakeFetch, requests } = rangeFetch(source, {
      behave: (range) => (range === badPart ? { status: 503 } : "hang"),
    });

    const promise = downloadTrack(
      "https://bucket/get",
      source.length,
      () => {},
      {
        fetch: fakeFetch,
      },
    );
    // Waits of 1 s, 2 s and 4 s sit between the part's four tries.
    await vi.advanceTimersByTimeAsync(7000);

    expect(await promise).toBeNull();
    expect(requests.filter((r) => r.range === badPart)).toHaveLength(4);
    const others = requests.filter((r) => r.range !== badPart);
    expect(others).toHaveLength(3);
    expect(others.every((r) => r.signal.aborted)).toBe(true);
  });

  it("reports progress as the total across parts and reaches bytes", async () => {
    const source = makeSource(4 * MIB);
    const { fetch: fakeFetch } = rangeFetch(source, { tickMs: 150 });
    const seen: number[] = [];

    const promise = downloadTrack(
      "https://bucket/get",
      source.length,
      (n) => seen.push(n),
      { fetch: fakeFetch },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(await promise).not.toBeNull();

    expect(seen.length).toBeGreaterThan(2);
    expect(seen[seen.length - 1]).toBe(source.length);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    }
    // One part is only a quarter of the song, so a total above that proves the
    // parts are summed rather than reported one at a time.
    expect(seen.some((n) => n > MIB && n < source.length)).toBe(true);
  });
});
