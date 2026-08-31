# DatesIdea v1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a deployed two-person peer-to-peer date-night room where video and audio flow directly browser-to-browser, both screens share a common timebase, and hand/face gestures raise meme overlays at the same instant on both sides.

**Architecture:** Raw `RTCPeerConnection` between exactly two peers, with Supabase Realtime carrying only offer/answer/ICE and Cloudflare TURN as the relay fallback. A single ordered `RTCDataChannel` carries a typed message union. On top of that channel, an NTP-style `SyncedClock` establishes a shared timebase so both peers can schedule an action at the same wall-clock moment. MediaPipe runs in a Web Worker, emits a compact per-frame summary, and pure threshold+hysteresis logic turns that summary into gesture events.

**Tech Stack:** Next.js 16.3.3 (App Router, `src/`, TypeScript), React 19.2.8, Tailwind v4, `motion` 13.1.1, `@mediapipe/tasks-vision` 1.0.1, `@supabase/supabase-js` 2.112.4, `nanoid` 6.0.1, Vitest 4.1.11.

**Spec:** `docs/superpowers/specs/2026-08-31-datesidea-foundation-design.md`

> **Superseded in part.** This plan was written against Supabase and executed as
> written. The backend was afterwards moved to Neon (Lakebase Postgres): Supabase
> Realtime signalling became a polled `signals` table behind Next.js route
> handlers, and the browser no longer talks to the database at all. Tasks 7 and 10
> below therefore describe code that has since been replaced. The **spec** is
> current; this plan is kept as the record of how v1 was built.

## Global Constraints

- **Exactly two participants.** No code path may assume more. No SFU, no media server.
- **Media never touches a server.** The only server-side code is `GET /api/turn` and Supabase history reads/writes.
- **Latency target is one-way media 90–110ms**, not sub-100ms round-trip. RTT floor on this link is ~180–220ms; never write copy or asserts that promise sub-100ms RTT.
- **Memes render at the identical instant on both screens.** The sender schedules its own render too — it must never render optimistically.
- **Meme lead time is `oneWay + 50ms`** (~150ms). Do not use a full RTT.
- **Hysteresis is mandatory on every gesture:** 300ms continuous hold to fire, 3s per-gesture cooldown, looser exit threshold than enter threshold.
- **Never post full landmark arrays across the worker boundary.** The worker emits derived scalars only.
- **No auth, no passwords, no user table.** Identity is a `localStorage` UUID. The room code is the capability.
- **Never ship a service-role key to the client.** `CLOUDFLARE_*` vars are server-only; only `NEXT_PUBLIC_SUPABASE_*` reach the browser.
- **Meme counts flush once at session end**, never per gesture — the hot path stays free of network writes.
- **A one-sided failure must never break the session.** Camera denied, MediaPipe unavailable, or worker crash all degrade to a working call.
- **Commit after every task.** Conventional-commit prefixes (`feat:`, `test:`, `chore:`, `fix:`).

## Visual Direction — La La Land

The whole surface is themed on *La La Land*: twilight romance, Griffith Observatory,
CinemaScope. This is a hard requirement, not a suggestion, and it applies to **both**
the homepage and the call page.

- **Palette** — twilight navy ground (`#0D1B34` → `#1B2A4A`), the film's dusk gradient
  running purple (`#6B4E8C`) into magenta (`#B85C8A`) into warm amber (`#E8B04B`), with
  dusty coral (`#E27D60`) and gold (`#F4C95D`) as accents. Dark by default — this is a
  night-time app and a light mode would fight the material.
- **Monogram** — **`M + K`** is the wordmark. It appears prominently on the homepage
  and persistently (smaller) on the call page. Set in the display face, gold, with the
  `+` visually lighter than the letters.
- **Type** — a high-contrast display serif or art-deco condensed face for the monogram
  and headings (echoing the film's title cards); a clean, quiet sans for everything
  functional. Load via `next/font`, never a raw `<link>`.
- **Motifs, used sparingly** — a static starfield behind the content, the dusk gradient
  as an ambient wash, and a soft film-grain overlay. Every one of these must sit behind
  `pointer-events-none` and must never obstruct video or controls.
- **Motion** — slow and warm. Nothing bouncy or app-like; think a gentle fade-up, not a
  spring. The one exception is the meme overlay, which stays springy and playful.
- **Restraint rule** — the video tiles are the subject. Decoration lives at the edges of
  the call page: the frame, the header, the status bar, the empty states. It never
  tints, overlays, or crops the video itself.
- **Accessibility** — body text must clear 4.5:1 against the twilight ground. Gold on
  navy passes; magenta on navy does not — use magenta for decoration only, never for
  text a person has to read. Respect `prefers-reduced-motion` by disabling the ambient
  animation and grain.

## Task Dependency Graph

```
Task 1 (tooling)
  ├── Task 2 (protocol) ──┬── Task 3 (SyncedClock)
  │                       ├── Task 7 (signaling)
  │                       └── Task 8 (peer connection)
  ├── Task 4 (identity + room code)
  ├── Task 5 (gestures — pure)  ── Task 9 (worker + hook)
  ├── Task 6 (/api/turn)
  └── Task 10 (history)

Task 11 (UI components)  ← needs Task 2 types only
Task 12 (page wiring)    ← needs 3,4,7,8,9,10,11
Task 13 (deploy + manual QA)  ← needs 12
```

**Parallel-safe groups** (no shared files, no shared state):
- After Task 1: **Tasks 2, 4, 6** may run concurrently.
- After Task 2: **Tasks 3, 5, 10, 11** may run concurrently.
- After Tasks 3+5: **Tasks 7, 8, 9** may run concurrently.

---

### Task 1: Tooling — dependencies, Vitest, environment scaffold

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/lib/env.ts`
- Create: `.env.local.example`
- Create: `src/lib/env.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm test` runs Vitest. `publicEnv()` returns `{ supabaseUrl: string; supabaseAnonKey: string }`, throwing a named error when a variable is missing.

- [ ] **Step 1: Install runtime and test dependencies**

```bash
npm install @supabase/supabase-js@2.112.4 @mediapipe/tasks-vision@1.0.1 motion@13.1.1 nanoid@6.0.1
npm install -D vitest@4.1.11 @vitejs/plugin-react@6.1.1 jsdom@30.0.1 @testing-library/react @testing-library/jest-dom
```

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
```

- [ ] **Step 3: Add the test scripts to `package.json`**

Add to the `"scripts"` object:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Write the failing test for env access**

Create `src/lib/env.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { publicEnv, MissingEnvError } from "./env";

const KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;
const saved: Record<string, string | undefined> = {};

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function setEnv(url?: string, key?: string) {
  for (const k of KEYS) saved[k] = process.env[k];
  if (url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  if (key === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = key;
}

describe("publicEnv", () => {
  it("returns the configured values", () => {
    setEnv("https://x.supabase.co", "anon-key");
    expect(publicEnv()).toEqual({
      supabaseUrl: "https://x.supabase.co",
      supabaseAnonKey: "anon-key",
    });
  });

  it("throws MissingEnvError naming the absent variable", () => {
    setEnv(undefined, "anon-key");
    expect(() => publicEnv()).toThrow(MissingEnvError);
    expect(() => publicEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npm test -- src/lib/env.test.ts`
Expected: FAIL — cannot resolve module `./env`.

- [ ] **Step 6: Implement `src/lib/env.ts`**

```ts
export class MissingEnvError extends Error {
  constructor(name: string) {
    super(`Missing required environment variable: ${name}`);
    this.name = "MissingEnvError";
  }
}

function required(name: string, value: string | undefined): string {
  if (!value) throw new MissingEnvError(name);
  return value;
}

export interface PublicEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

/** Browser-safe configuration. Never add a secret to this function. */
export function publicEnv(): PublicEnv {
  return {
    supabaseUrl: required(
      "NEXT_PUBLIC_SUPABASE_URL",
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    ),
    supabaseAnonKey: required(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
  };
}
```

- [ ] **Step 7: Create `.env.local.example`**

```
# Browser-visible. Safe to expose.
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Server-only. Never prefix these with NEXT_PUBLIC_.
CLOUDFLARE_TURN_KEY_ID=
CLOUDFLARE_TURN_API_TOKEN=
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm test`
Expected: PASS, 2 tests.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/lib/env.ts src/lib/env.test.ts .env.local.example
git commit -m "chore: add vitest, runtime deps, and typed env access"
```

---

### Task 2: Peer message protocol

**Files:**
- Create: `src/lib/rtc/protocol.ts`
- Test: `src/lib/rtc/protocol.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type MemeId = "heart" | "peace" | "thumbsUp" | "smile"`
  - `const MEME_IDS: readonly MemeId[]`
  - `type PeerMessage` — union of `hello`, `ping`, `pong`, `meme`
  - `encode(m: PeerMessage): string`
  - `decode(raw: string): PeerMessage | null` — returns `null` for anything malformed, never throws

- [ ] **Step 1: Write the failing test**

Create `src/lib/rtc/protocol.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { encode, decode, MEME_IDS, type PeerMessage } from "./protocol";

describe("protocol", () => {
  const cases: PeerMessage[] = [
    { t: "hello", identity: "id-1", name: "Ben" },
    { t: "ping", t0: 1000 },
    { t: "pong", t0: 1000, t1: 1090 },
    { t: "meme", id: "heart", showAt: 1234567 },
  ];

  it.each(cases)("round-trips %o", (msg) => {
    expect(decode(encode(msg))).toEqual(msg);
  });

  it("returns null for non-JSON", () => {
    expect(decode("not json")).toBeNull();
  });

  it("returns null for an unknown message type", () => {
    expect(decode(JSON.stringify({ t: "explode" }))).toBeNull();
  });

  it("returns null when a required field is missing", () => {
    expect(decode(JSON.stringify({ t: "ping" }))).toBeNull();
    expect(decode(JSON.stringify({ t: "meme", id: "heart" }))).toBeNull();
  });

  it("returns null for an unknown meme id", () => {
    expect(decode(JSON.stringify({ t: "meme", id: "banana", showAt: 1 }))).toBeNull();
  });

  it("exposes exactly the four v1 meme ids", () => {
    expect([...MEME_IDS]).toEqual(["heart", "peace", "thumbsUp", "smile"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/rtc/protocol.test.ts`
Expected: FAIL — cannot resolve `./protocol`.

- [ ] **Step 3: Implement `src/lib/rtc/protocol.ts`**

```ts
export const MEME_IDS = ["heart", "peace", "thumbsUp", "smile"] as const;
export type MemeId = (typeof MEME_IDS)[number];

export function isMemeId(v: unknown): v is MemeId {
  return typeof v === "string" && (MEME_IDS as readonly string[]).includes(v);
}

export type PeerMessage =
  | { t: "hello"; identity: string; name: string }
  | { t: "ping"; t0: number }
  | { t: "pong"; t0: number; t1: number }
  | { t: "meme"; id: MemeId; showAt: number };

export function encode(m: PeerMessage): string {
  return JSON.stringify(m);
}

const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";

/**
 * Parses an inbound DataChannel payload. Returns null rather than throwing:
 * a malformed frame from the peer must never take down the session.
 */
export function decode(raw: string): PeerMessage | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const m = v as Record<string, unknown>;

  switch (m.t) {
    case "hello":
      return isStr(m.identity) && isStr(m.name)
        ? { t: "hello", identity: m.identity, name: m.name }
        : null;
    case "ping":
      return isNum(m.t0) ? { t: "ping", t0: m.t0 } : null;
    case "pong":
      return isNum(m.t0) && isNum(m.t1)
        ? { t: "pong", t0: m.t0, t1: m.t1 }
        : null;
    case "meme":
      return isMemeId(m.id) && isNum(m.showAt)
        ? { t: "meme", id: m.id, showAt: m.showAt }
        : null;
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/rtc/protocol.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rtc/protocol.ts src/lib/rtc/protocol.test.ts
git commit -m "feat: add typed peer message protocol with tolerant decoding"
```

---

### Task 3: SyncedClock

**Files:**
- Create: `src/lib/sync/SyncedClock.ts`
- Test: `src/lib/sync/SyncedClock.test.ts`

**Interfaces:**
- Consumes: `PeerMessage`, `encode` from `@/lib/rtc/protocol`.
- Produces:
  - `selectSample(samples: ClockSample[]): ClockSample | null` — picks minimum RTT
  - `interface ClockSample { rtt: number; offset: number }`
  - `class SyncedClock` with `now()`, `rtt`, `oneWay`, `leadTime()`, `scheduleAt(t, fn)`, `lateFires`, `synced`, `handleMessage(m)`, `startSync()`, `stop()`

**Design note for the implementer:** averaging offsets across samples is *worse* than taking the single lowest-RTT sample. A high-RTT sample means one leg of the trip was queued, which biases `offset` by exactly the amount you cannot measure. The lowest-RTT sample is the one where that bias is smallest. This is the standard NTP result and the tests below encode it — do not "improve" it into a mean.

- [ ] **Step 1: Write the failing test**

Create `src/lib/sync/SyncedClock.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SyncedClock, selectSample, type ClockSample } from "./SyncedClock";
import type { PeerMessage } from "@/lib/rtc/protocol";

describe("selectSample", () => {
  it("returns null for no samples", () => {
    expect(selectSample([])).toBeNull();
  });

  it("picks the sample with the lowest rtt, not the mean", () => {
    const samples: ClockSample[] = [
      { rtt: 400, offset: 900 },
      { rtt: 200, offset: 1000 },
      { rtt: 380, offset: 1150 },
    ];
    expect(selectSample(samples)).toEqual({ rtt: 200, offset: 1000 });
  });

  it("ignores a badly skewed high-rtt sample that would poison an average", () => {
    // True offset is 1000. The 2000ms sample is skewed by a stalled return leg.
    const samples: ClockSample[] = [
      { rtt: 210, offset: 1002 },
      { rtt: 2000, offset: 1850 },
    ];
    const chosen = selectSample(samples)!;
    expect(chosen.offset).toBe(1002);
    // An average would have produced ~1426 — far outside tolerance.
    expect(Math.abs(chosen.offset - 1000)).toBeLessThan(50);
  });
});

describe("SyncedClock", () => {
  let sent: PeerMessage[];
  let fakeNow: number;
  const now = () => fakeNow;

  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    fakeNow = 10_000;
  });
  afterEach(() => vi.useRealTimers());

  function makeClock() {
    return new SyncedClock({
      send: (m) => sent.push(m),
      now,
      samples: 3,
    });
  }

  it("is not synced before any pong arrives", () => {
    const c = makeClock();
    expect(c.synced).toBe(false);
    expect(c.now()).toBe(10_000);
  });

  it("computes offset from a ping/pong exchange", () => {
    const c = makeClock();
    c.startSync();
    // One ping was sent at t0 = 10000.
    const ping = sent.at(-1) as { t: "ping"; t0: number };
    expect(ping.t).toBe("ping");

    // Peer's clock is 5000ms ahead. Symmetric 200ms round trip.
    fakeNow = 10_200;
    c.handleMessage({ t: "pong", t0: ping.t0, t1: ping.t0 + 100 + 5000 });

    expect(c.rtt).toBe(200);
    expect(c.oneWay).toBe(100);
    expect(c.offset).toBe(5000);
    expect(c.now()).toBe(15_200);
    expect(c.synced).toBe(true);
  });

  it("replies to a ping with a pong carrying local receipt time", () => {
    const c = makeClock();
    fakeNow = 42_000;
    c.handleMessage({ t: "ping", t0: 7 });
    expect(sent.at(-1)).toEqual({ t: "pong", t0: 7, t1: 42_000 });
  });

  it("leadTime is oneWay plus a 50ms buffer", () => {
    const c = makeClock();
    c.startSync();
    const ping = sent.at(-1) as { t: "ping"; t0: number };
    fakeNow = 10_200;
    c.handleMessage({ t: "pong", t0: ping.t0, t1: ping.t0 + 100 });
    expect(c.leadTime()).toBe(150);
  });

  it("scheduleAt fires the callback at the shared timestamp", () => {
    const c = makeClock();
    const fn = vi.fn();
    c.scheduleAt(10_300, fn);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(299);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("scheduleAt fires immediately and counts a late fire for a past target", () => {
    const c = makeClock();
    const fn = vi.fn();
    c.scheduleAt(9_000, fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(c.lateFires).toBe(1);
  });

  it("stop cancels pending scheduled callbacks", () => {
    const c = makeClock();
    const fn = vi.fn();
    c.scheduleAt(10_500, fn);
    c.stop();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/sync/SyncedClock.test.ts`
Expected: FAIL — cannot resolve `./SyncedClock`.

- [ ] **Step 3: Implement `src/lib/sync/SyncedClock.ts`**

```ts
import type { PeerMessage } from "@/lib/rtc/protocol";

export interface ClockSample {
  rtt: number;
  offset: number;
}

/**
 * Picks the sample least polluted by queueing jitter: the one with the
 * lowest round-trip time. Do NOT average — a high-RTT sample carries an
 * asymmetric, unmeasurable bias, and averaging drags the estimate into it.
 */
export function selectSample(samples: ClockSample[]): ClockSample | null {
  if (samples.length === 0) return null;
  return samples.reduce((best, s) => (s.rtt < best.rtt ? s : best));
}

export const LEAD_BUFFER_MS = 50;
const DEFAULT_SAMPLES = 7;
const SAMPLE_INTERVAL_MS = 120;
const RESYNC_INTERVAL_MS = 30_000;

export interface SyncedClockOptions {
  send: (m: PeerMessage) => void;
  now?: () => number;
  samples?: number;
}

export class SyncedClock {
  private readonly send: (m: PeerMessage) => void;
  private readonly localNow: () => number;
  private readonly sampleTarget: number;

  private pending = new Map<number, number>();
  private collected: ClockSample[] = [];
  private best: ClockSample | null = null;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private resyncTimer: ReturnType<typeof setInterval> | null = null;
  private _lateFires = 0;

  constructor(opts: SyncedClockOptions) {
    this.send = opts.send;
    this.localNow = opts.now ?? Date.now;
    this.sampleTarget = opts.samples ?? DEFAULT_SAMPLES;
  }

  get synced(): boolean {
    return this.best !== null;
  }
  get offset(): number {
    return this.best?.offset ?? 0;
  }
  get rtt(): number {
    return this.best?.rtt ?? 0;
  }
  get oneWay(): number {
    return this.rtt / 2;
  }
  get lateFires(): number {
    return this._lateFires;
  }

  /** Shared timebase. Equal on both peers to within one-way jitter. */
  now(): number {
    return this.localNow() + this.offset;
  }

  /** How far ahead to schedule so the peer receives the instruction in time. */
  leadTime(): number {
    return this.oneWay + LEAD_BUFFER_MS;
  }

  scheduleAt(sharedTime: number, fn: () => void): void {
    const delay = sharedTime - this.now();
    if (delay <= 0) {
      this._lateFires += 1;
      fn();
      return;
    }
    const id = setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, delay);
    this.timers.add(id);
  }

  startSync(): void {
    this.collected = [];
    this.emitPing();
    for (let i = 1; i < this.sampleTarget; i++) {
      const id = setTimeout(() => {
        this.timers.delete(id);
        this.emitPing();
      }, i * SAMPLE_INTERVAL_MS);
      this.timers.add(id);
    }
    if (this.resyncTimer === null) {
      this.resyncTimer = setInterval(() => this.startSync(), RESYNC_INTERVAL_MS);
    }
  }

  handleMessage(m: PeerMessage): void {
    if (m.t === "ping") {
      this.send({ t: "pong", t0: m.t0, t1: this.localNow() });
      return;
    }
    if (m.t !== "pong") return;

    const sentAt = this.pending.get(m.t0);
    if (sentAt === undefined) return;
    this.pending.delete(m.t0);

    const t2 = this.localNow();
    const rtt = t2 - sentAt;
    const offset = m.t1 - (sentAt + rtt / 2);
    this.collected.push({ rtt, offset });

    const winner = selectSample(this.collected);
    if (winner) this.best = winner;
  }

  stop(): void {
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
    if (this.resyncTimer !== null) {
      clearInterval(this.resyncTimer);
      this.resyncTimer = null;
    }
    this.pending.clear();
  }

  private emitPing(): void {
    const t0 = this.localNow();
    this.pending.set(t0, t0);
    this.send({ t: "ping", t0 });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/sync/SyncedClock.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sync/SyncedClock.ts src/lib/sync/SyncedClock.test.ts
git commit -m "feat: add SyncedClock shared timebase with min-RTT offset selection"
```

---

### Task 4: Identity and room codes

**Files:**
- Create: `src/lib/history/identity.ts`
- Create: `src/lib/room/code.ts`
- Test: `src/lib/history/identity.test.ts`
- Test: `src/lib/room/code.test.ts`

**Interfaces:**
- Consumes: `nanoid`.
- Produces:
  - `getIdentity(): string` — stable per-device UUID from `localStorage`
  - `getDisplayName(): string | null`, `setDisplayName(n: string): void`
  - `getSavedRoom(): string | null`, `saveRoom(code: string): void`
  - `newRoomCode(): string` — 6 chars from an unambiguous alphabet
  - `isValidRoomCode(v: string): boolean`
  - `ROOM_CODE_ALPHABET: string`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/room/code.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { newRoomCode, isValidRoomCode, ROOM_CODE_ALPHABET } from "./code";

describe("room codes", () => {
  it("generates 6 characters from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const c = newRoomCode();
      expect(c).toHaveLength(6);
      for (const ch of c) expect(ROOM_CODE_ALPHABET).toContain(ch);
    }
  });

  it("excludes visually ambiguous characters", () => {
    for (const ch of ["0", "O", "1", "I", "L"]) {
      expect(ROOM_CODE_ALPHABET).not.toContain(ch);
    }
  });

  it("accepts its own output", () => {
    expect(isValidRoomCode(newRoomCode())).toBe(true);
  });

  it("normalizes case when validating", () => {
    const c = newRoomCode();
    expect(isValidRoomCode(c.toLowerCase())).toBe(true);
  });

  it("rejects wrong length and out-of-alphabet input", () => {
    expect(isValidRoomCode("ABC")).toBe(false);
    expect(isValidRoomCode("ABCDEFG")).toBe(false);
    expect(isValidRoomCode("ABC0EF")).toBe(false);
    expect(isValidRoomCode("")).toBe(false);
  });
});
```

Create `src/lib/history/identity.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  getIdentity,
  getDisplayName,
  setDisplayName,
  getSavedRoom,
  saveRoom,
} from "./identity";

beforeEach(() => localStorage.clear());

describe("identity", () => {
  it("returns a stable id across calls", () => {
    const a = getIdentity();
    const b = getIdentity();
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(10);
  });

  it("persists the id in localStorage", () => {
    const id = getIdentity();
    expect(localStorage.getItem("datesidea.identity")).toBe(id);
  });

  it("round-trips a display name", () => {
    expect(getDisplayName()).toBeNull();
    setDisplayName("Ben");
    expect(getDisplayName()).toBe("Ben");
  });

  it("round-trips the saved room, upper-cased", () => {
    expect(getSavedRoom()).toBeNull();
    saveRoom("abcdef");
    expect(getSavedRoom()).toBe("ABCDEF");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/lib/room/code.test.ts src/lib/history/identity.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/lib/room/code.ts`**

```ts
import { customAlphabet } from "nanoid";

/** No 0/O, 1/I/L — these get misread when a code is typed from a text message. */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 6;

const generate = customAlphabet(ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH);

export function newRoomCode(): string {
  return generate();
}

export function isValidRoomCode(v: string): boolean {
  const c = v.toUpperCase();
  if (c.length !== ROOM_CODE_LENGTH) return false;
  return [...c].every((ch) => ROOM_CODE_ALPHABET.includes(ch));
}
```

- [ ] **Step 4: Implement `src/lib/history/identity.ts`**

```ts
const IDENTITY_KEY = "datesidea.identity";
const NAME_KEY = "datesidea.name";
const ROOM_KEY = "datesidea.room";

/**
 * A device-local UUID. This is not an account — it exists only so history
 * rows can tell the two participants apart.
 */
export function getIdentity(): string {
  const existing = localStorage.getItem(IDENTITY_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(IDENTITY_KEY, id);
  return id;
}

export function getDisplayName(): string | null {
  return localStorage.getItem(NAME_KEY);
}

export function setDisplayName(name: string): void {
  localStorage.setItem(NAME_KEY, name);
}

export function getSavedRoom(): string | null {
  return localStorage.getItem(ROOM_KEY);
}

export function saveRoom(code: string): void {
  localStorage.setItem(ROOM_KEY, code.toUpperCase());
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- src/lib/room/code.test.ts src/lib/history/identity.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/room src/lib/history
git commit -m "feat: add device identity and unambiguous room codes"
```

---

### Task 5: Gesture detection — pure logic

**Files:**
- Create: `src/lib/vision/types.ts`
- Create: `src/lib/vision/gestures.ts`
- Test: `src/lib/vision/gestures.test.ts`

**Interfaces:**
- Consumes: `MemeId`, `MEME_IDS` from `@/lib/rtc/protocol`.
- Produces:
  - `interface Point { x: number; y: number }`
  - `interface HandSummary { handedness, extended: {thumb,index,middle,ring,pinky: boolean}, thumbTip, indexTip, wrist, scale }`
  - `interface VisionFrame { timestamp: number; smileScore: number; hands: HandSummary[] }`
  - `detectRaw(frame: VisionFrame, active: ReadonlySet<MemeId>): Set<MemeId>`
  - `class GestureTracker` with `update(frame: VisionFrame): MemeId[]`
  - `HOLD_MS = 300`, `COOLDOWN_MS = 3000`

**Design note for the implementer:** `detectRaw` takes the currently-active set so it can apply a *looser* threshold to gestures already firing. This is the hysteresis that stops flicker at the boundary. `GestureTracker` layers hold-time and cooldown on top. Both are pure — no timers, no `Date.now()`; time arrives as `frame.timestamp`. That is what makes them testable.

- [ ] **Step 1: Write the failing test**

Create `src/lib/vision/gestures.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  detectRaw,
  GestureTracker,
  HOLD_MS,
  COOLDOWN_MS,
} from "./gestures";
import type { HandSummary, VisionFrame } from "./types";

function hand(over: Partial<HandSummary> = {}): HandSummary {
  return {
    handedness: "Right",
    extended: { thumb: false, index: false, middle: false, ring: false, pinky: false },
    thumbTip: { x: 0.5, y: 0.5 },
    indexTip: { x: 0.5, y: 0.4 },
    wrist: { x: 0.5, y: 0.7 },
    scale: 0.1,
    ...over,
  };
}

function frame(over: Partial<VisionFrame> = {}): VisionFrame {
  return { timestamp: 0, smileScore: 0, hands: [], ...over };
}

const none = new Set<never>();

describe("detectRaw", () => {
  it("detects peace: index and middle extended, ring and pinky curled", () => {
    const f = frame({
      hands: [hand({ extended: { thumb: false, index: true, middle: true, ring: false, pinky: false } })],
    });
    expect(detectRaw(f, none).has("peace")).toBe(true);
  });

  it("does not detect peace when the ring finger is also extended", () => {
    const f = frame({
      hands: [hand({ extended: { thumb: false, index: true, middle: true, ring: true, pinky: false } })],
    });
    expect(detectRaw(f, none).has("peace")).toBe(false);
  });

  it("detects thumbsUp only when the thumb points up", () => {
    const up = frame({
      hands: [hand({
        extended: { thumb: true, index: false, middle: false, ring: false, pinky: false },
        thumbTip: { x: 0.5, y: 0.3 },
        wrist: { x: 0.5, y: 0.7 },
      })],
    });
    expect(detectRaw(up, none).has("thumbsUp")).toBe(true);

    const down = frame({
      hands: [hand({
        extended: { thumb: true, index: false, middle: false, ring: false, pinky: false },
        thumbTip: { x: 0.5, y: 0.9 },
        wrist: { x: 0.5, y: 0.7 },
      })],
    });
    expect(detectRaw(down, none).has("thumbsUp")).toBe(false);
  });

  it("detects a smile above threshold", () => {
    expect(detectRaw(frame({ smileScore: 0.8 }), none).has("smile")).toBe(true);
    expect(detectRaw(frame({ smileScore: 0.2 }), none).has("smile")).toBe(false);
  });

  it("detects heart when two hands bring thumb and index tips together", () => {
    const f = frame({
      hands: [
        hand({ handedness: "Left", thumbTip: { x: 0.48, y: 0.5 }, indexTip: { x: 0.49, y: 0.42 } }),
        hand({ handedness: "Right", thumbTip: { x: 0.50, y: 0.5 }, indexTip: { x: 0.51, y: 0.42 } }),
      ],
    });
    expect(detectRaw(f, none).has("heart")).toBe(true);
  });

  it("does not detect heart with hands far apart", () => {
    const f = frame({
      hands: [
        hand({ handedness: "Left", thumbTip: { x: 0.1, y: 0.5 }, indexTip: { x: 0.1, y: 0.4 } }),
        hand({ handedness: "Right", thumbTip: { x: 0.9, y: 0.5 }, indexTip: { x: 0.9, y: 0.4 } }),
      ],
    });
    expect(detectRaw(f, none).has("heart")).toBe(false);
  });

  it("does not detect heart with only one hand", () => {
    expect(detectRaw(frame({ hands: [hand()] }), none).has("heart")).toBe(false);
  });

  it("applies a looser threshold to an already-active gesture (hysteresis)", () => {
    // Just past the enter threshold for smile, but inside the exit threshold.
    const borderline = frame({ smileScore: 0.45 });
    expect(detectRaw(borderline, none).has("smile")).toBe(false);
    expect(detectRaw(borderline, new Set(["smile"] as const)).has("smile")).toBe(true);
  });
});

describe("GestureTracker", () => {
  const smiling = (t: number) => frame({ timestamp: t, smileScore: 0.9 });
  const neutral = (t: number) => frame({ timestamp: t, smileScore: 0.0 });

  it("does not fire before the hold time elapses", () => {
    const g = new GestureTracker();
    expect(g.update(smiling(0))).toEqual([]);
    expect(g.update(smiling(HOLD_MS - 1))).toEqual([]);
  });

  it("fires once the gesture has been held long enough", () => {
    const g = new GestureTracker();
    g.update(smiling(0));
    expect(g.update(smiling(HOLD_MS))).toEqual(["smile"]);
  });

  it("fires only once per continuous hold", () => {
    const g = new GestureTracker();
    g.update(smiling(0));
    expect(g.update(smiling(HOLD_MS))).toEqual(["smile"]);
    expect(g.update(smiling(HOLD_MS + 100))).toEqual([]);
    expect(g.update(smiling(HOLD_MS + 500))).toEqual([]);
  });

  it("does not re-fire within the cooldown window", () => {
    const g = new GestureTracker();
    g.update(smiling(0));
    expect(g.update(smiling(HOLD_MS))).toEqual(["smile"]);
    g.update(neutral(HOLD_MS + 10));
    g.update(smiling(HOLD_MS + 20));
    expect(g.update(smiling(HOLD_MS + 20 + HOLD_MS))).toEqual([]);
  });

  it("fires again after the cooldown has expired", () => {
    const g = new GestureTracker();
    g.update(smiling(0));
    expect(g.update(smiling(HOLD_MS))).toEqual(["smile"]);

    const later = HOLD_MS + COOLDOWN_MS + 10;
    g.update(neutral(later - 1));
    g.update(smiling(later));
    expect(g.update(smiling(later + HOLD_MS))).toEqual(["smile"]);
  });

  it("resets the hold timer when the gesture lapses", () => {
    const g = new GestureTracker();
    g.update(smiling(0));
    g.update(neutral(100));
    g.update(smiling(150));
    expect(g.update(smiling(150 + HOLD_MS - 1))).toEqual([]);
    expect(g.update(smiling(150 + HOLD_MS))).toEqual(["smile"]);
  });

  it("tracks gestures independently", () => {
    const g = new GestureTracker();
    const both = (t: number) =>
      frame({
        timestamp: t,
        smileScore: 0.9,
        hands: [hand({ extended: { thumb: false, index: true, middle: true, ring: false, pinky: false } })],
      });
    g.update(both(0));
    expect(g.update(both(HOLD_MS)).sort()).toEqual(["peace", "smile"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/vision/gestures.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/lib/vision/types.ts`**

```ts
export interface Point {
  x: number;
  y: number;
}

export interface FingerStates {
  thumb: boolean;
  index: boolean;
  middle: boolean;
  ring: boolean;
  pinky: boolean;
}

/**
 * The compact per-hand summary the worker emits. Deliberately NOT the full
 * 21-landmark array — serializing those 30x/second costs more than the
 * inference itself.
 */
export interface HandSummary {
  handedness: "Left" | "Right";
  extended: FingerStates;
  thumbTip: Point;
  indexTip: Point;
  wrist: Point;
  /** Wrist to middle-finger MCP distance, used to normalize other distances. */
  scale: number;
}

export interface VisionFrame {
  /** Milliseconds, monotonic. Supplied by the caller; never read from a clock. */
  timestamp: number;
  /** Max of the mouthSmileLeft / mouthSmileRight ARKit blendshapes, 0..1. */
  smileScore: number;
  hands: HandSummary[];
}
```

- [ ] **Step 4: Implement `src/lib/vision/gestures.ts`**

```ts
import { MEME_IDS, type MemeId } from "@/lib/rtc/protocol";
import type { HandSummary, Point, VisionFrame } from "./types";

export const HOLD_MS = 300;
export const COOLDOWN_MS = 3000;

/** Enter thresholds are strict; exit thresholds are loose. The gap is the hysteresis. */
const SMILE_ENTER = 0.55;
const SMILE_EXIT = 0.4;
/** Distance between the two hands' fingertips, in units of hand scale. */
const HEART_ENTER = 0.6;
const HEART_EXIT = 0.95;

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function isPeace(h: HandSummary): boolean {
  const e = h.extended;
  return e.index && e.middle && !e.ring && !e.pinky;
}

function isThumbsUp(h: HandSummary): boolean {
  const e = h.extended;
  if (!e.thumb || e.index || e.middle || e.ring || e.pinky) return false;
  // Image coordinates: y increases downward, so "up" means a smaller y.
  return h.thumbTip.y < h.wrist.y;
}

function isHeart(hands: HandSummary[], threshold: number): boolean {
  if (hands.length < 2) return false;
  const [a, b] = hands;
  const scale = (a.scale + b.scale) / 2;
  if (scale <= 0) return false;
  const thumbGap = dist(a.thumbTip, b.thumbTip) / scale;
  const indexGap = dist(a.indexTip, b.indexTip) / scale;
  return thumbGap < threshold && indexGap < threshold;
}

/**
 * Per-frame gesture presence. `active` holds the gestures currently firing;
 * those get the looser exit threshold so a value sitting on the boundary
 * does not flicker on and off.
 */
export function detectRaw(
  frame: VisionFrame,
  active: ReadonlySet<MemeId>,
): Set<MemeId> {
  const out = new Set<MemeId>();

  if (frame.smileScore >= (active.has("smile") ? SMILE_EXIT : SMILE_ENTER)) {
    out.add("smile");
  }
  if (isHeart(frame.hands, active.has("heart") ? HEART_EXIT : HEART_ENTER)) {
    out.add("heart");
  }
  for (const h of frame.hands) {
    if (isPeace(h)) out.add("peace");
    if (isThumbsUp(h)) out.add("thumbsUp");
  }
  return out;
}

interface GestureState {
  heldSince: number | null;
  firedAt: number | null;
}

/**
 * Turns per-frame presence into discrete events. A raw threshold fires ~30
 * times a second; hold-time and cooldown are what make the overlay watchable.
 */
export class GestureTracker {
  private active = new Set<MemeId>();
  private state: Record<MemeId, GestureState>;

  constructor() {
    this.state = Object.fromEntries(
      MEME_IDS.map((id) => [id, { heldSince: null, firedAt: null }]),
    ) as Record<MemeId, GestureState>;
  }

  update(frame: VisionFrame): MemeId[] {
    const present = detectRaw(frame, this.active);
    const fired: MemeId[] = [];
    const t = frame.timestamp;

    for (const id of MEME_IDS) {
      const s = this.state[id];
      if (!present.has(id)) {
        s.heldSince = null;
        continue;
      }
      if (s.heldSince === null) {
        s.heldSince = t;
        continue;
      }
      const heldLongEnough = t - s.heldSince >= HOLD_MS;
      const alreadyFiredThisHold = s.firedAt !== null && s.firedAt >= s.heldSince;
      const coolingDown = s.firedAt !== null && t - s.firedAt < COOLDOWN_MS;

      if (heldLongEnough && !alreadyFiredThisHold && !coolingDown) {
        s.firedAt = t;
        fired.push(id);
      }
    }

    this.active = present;
    return fired;
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- src/lib/vision/gestures.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/vision/types.ts src/lib/vision/gestures.ts src/lib/vision/gestures.test.ts
git commit -m "feat: add pure gesture detection with hold-time and cooldown hysteresis"
```

---

### Task 6: TURN credential route

**Files:**
- Create: `src/app/api/turn/route.ts`
- Create: `src/lib/rtc/iceServers.ts`
- Test: `src/app/api/turn/route.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `GET /api/turn` → `{ iceServers: RTCIceServer[] }`
  - `fetchIceServers(): Promise<RTCIceServer[]>` from `iceServers.ts` — calls the route, falls back to public STUN on failure
  - `FALLBACK_ICE_SERVERS: RTCIceServer[]`

**API reference (verified 2026-08-31):**
`POST https://rtc.live.cloudflare.com/v1/turn/keys/{TURN_KEY_ID}/credentials/generate-ice-servers`
Headers: `Authorization: Bearer {TURN_KEY_API_TOKEN}`, `Content-Type: application/json`
Body: `{"ttl": 7200}`
Response 201: `{ "iceServers": [ { "urls": [...] }, { "urls": [...], "username": "...", "credential": "..." } ] }`

- [ ] **Step 1: Write the failing test**

Create `src/app/api/turn/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "./route";

const CF_RESPONSE = {
  iceServers: [
    { urls: ["stun:stun.cloudflare.com:3478"] },
    {
      urls: ["turn:turn.cloudflare.com:3478?transport=udp"],
      username: "user-abc",
      credential: "cred-xyz",
    },
  ],
};

beforeEach(() => {
  process.env.CLOUDFLARE_TURN_KEY_ID = "key-1";
  process.env.CLOUDFLARE_TURN_API_TOKEN = "token-1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.CLOUDFLARE_TURN_KEY_ID;
  delete process.env.CLOUDFLARE_TURN_API_TOKEN;
});

describe("GET /api/turn", () => {
  it("returns Cloudflare's ice servers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(CF_RESPONSE), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(CF_RESPONSE);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://rtc.live.cloudflare.com/v1/turn/keys/key-1/credentials/generate-ice-servers",
    );
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer token-1");
    expect(JSON.parse(init.body)).toEqual({ ttl: 7200 });
  });

  it("never leaks the api token in the response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(CF_RESPONSE), { status: 201 })),
    );
    const body = await (await GET()).text();
    expect(body).not.toContain("token-1");
  });

  it("returns 503 with fallback stun when credentials are unconfigured", async () => {
    delete process.env.CLOUDFLARE_TURN_KEY_ID;
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.iceServers[0].urls).toContain("stun:stun.l.google.com:19302");
  });

  it("returns 502 with fallback stun when Cloudflare errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));
    const res = await GET();
    expect(res.status).toBe(502);
    expect((await res.json()).iceServers.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/app/api/turn/route.test.ts`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Implement `src/app/api/turn/route.ts`**

```ts
import { NextResponse } from "next/server";

export const runtime = "edge";
/** Credentials are per-request and short-lived; caching them would be wrong. */
export const dynamic = "force-dynamic";

const TTL_SECONDS = 7200;

/**
 * Public STUN only. Enough to establish a direct connection on friendly
 * networks; a symmetric-NAT peer will fail to connect with just this, which
 * is why the UI must surface the degraded state rather than hide it.
 */
export const FALLBACK_ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

export async function GET() {
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const token = process.env.CLOUDFLARE_TURN_API_TOKEN;

  if (!keyId || !token) {
    return NextResponse.json(
      { iceServers: FALLBACK_ICE_SERVERS, degraded: "turn-unconfigured" },
      { status: 503 },
    );
  }

  try {
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl: TTL_SECONDS }),
      },
    );

    if (!res.ok) {
      // Deliberately does not echo the upstream body — it may contain the token.
      return NextResponse.json(
        { iceServers: FALLBACK_ICE_SERVERS, degraded: "turn-upstream-error" },
        { status: 502 },
      );
    }

    return NextResponse.json(await res.json(), { status: 200 });
  } catch {
    return NextResponse.json(
      { iceServers: FALLBACK_ICE_SERVERS, degraded: "turn-unreachable" },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 4: Implement `src/lib/rtc/iceServers.ts`**

```ts
export const FALLBACK_ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

export interface IceResult {
  iceServers: RTCIceServer[];
  /** Set when TURN was unavailable — the UI surfaces this rather than hiding it. */
  degraded?: string;
}

export async function fetchIceServers(): Promise<IceResult> {
  try {
    const res = await fetch("/api/turn");
    const body = (await res.json()) as IceResult;
    if (!Array.isArray(body.iceServers) || body.iceServers.length === 0) {
      return { iceServers: FALLBACK_ICE_SERVERS, degraded: "turn-empty" };
    }
    return body;
  } catch {
    return { iceServers: FALLBACK_ICE_SERVERS, degraded: "turn-fetch-failed" };
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- src/app/api/turn/route.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/turn src/lib/rtc/iceServers.ts
git commit -m "feat: mint short-lived Cloudflare TURN credentials server-side"
```

---

### Task 7: Supabase signaling

**Files:**
- Create: `src/lib/signaling/supabaseClient.ts`
- Create: `src/lib/signaling/useSignaling.ts`
- Test: `src/lib/signaling/useSignaling.test.ts`

**Interfaces:**
- Consumes: `publicEnv` from `@/lib/env`; `getIdentity` from `@/lib/history/identity`.
- Produces:
  - `getSupabase(): SupabaseClient` (memoized singleton)
  - `type SignalMessage = { kind: "join"; identity: string; joinedAt: number } | { kind: "offer"|"answer"; sdp: string; from: string } | { kind: "ice"; candidate: RTCIceCandidateInit; from: string }`
  - `shouldOffer(me: {identity,joinedAt}, them: {identity,joinedAt}): boolean` — the glare tiebreak
  - `useSignaling(code, handlers): { send, status }`

**Design note:** `shouldOffer` is the glare resolution and is the only part of this task with real logic, so it is extracted as a pure function and tested. The hook itself is thin plumbing over Supabase Realtime broadcast and is covered by the manual QA in Task 13.

- [ ] **Step 1: Write the failing test**

Create `src/lib/signaling/useSignaling.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shouldOffer } from "./useSignaling";

describe("shouldOffer (glare tiebreak)", () => {
  it("the earlier joiner offers", () => {
    const me = { identity: "b", joinedAt: 100 };
    const them = { identity: "a", joinedAt: 200 };
    expect(shouldOffer(me, them)).toBe(true);
    expect(shouldOffer(them, me)).toBe(false);
  });

  it("breaks an exact tie by lexicographic identity", () => {
    const a = { identity: "aaa", joinedAt: 100 };
    const b = { identity: "bbb", joinedAt: 100 };
    expect(shouldOffer(a, b)).toBe(true);
    expect(shouldOffer(b, a)).toBe(false);
  });

  it("is always asymmetric — exactly one peer offers", () => {
    const pairs = [
      [{ identity: "x", joinedAt: 1 }, { identity: "y", joinedAt: 2 }],
      [{ identity: "y", joinedAt: 2 }, { identity: "x", joinedAt: 1 }],
      [{ identity: "m", joinedAt: 5 }, { identity: "n", joinedAt: 5 }],
    ] as const;
    for (const [p, q] of pairs) {
      expect(shouldOffer(p, q)).not.toBe(shouldOffer(q, p));
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/signaling/useSignaling.test.ts`
Expected: FAIL — cannot resolve `./useSignaling`.

- [ ] **Step 3: Implement `src/lib/signaling/supabaseClient.ts`**

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;
  const { supabaseUrl, supabaseAnonKey } = publicEnv();
  client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    realtime: { params: { eventsPerSecond: 20 } },
  });
  return client;
}
```

- [ ] **Step 4: Implement `src/lib/signaling/useSignaling.ts`**

```ts
"use client";

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "./supabaseClient";
import { getIdentity } from "@/lib/history/identity";

export interface PeerInfo {
  identity: string;
  joinedAt: number;
}

export type SignalMessage =
  | { kind: "join"; identity: string; joinedAt: number }
  | { kind: "offer"; sdp: string; from: string }
  | { kind: "answer"; sdp: string; from: string }
  | { kind: "ice"; candidate: RTCIceCandidateInit; from: string };

/**
 * Exactly one peer must create the offer, or both stall waiting for an
 * answer. Earlier joiner wins; identical timestamps break lexicographically.
 * Asymmetric by construction.
 */
export function shouldOffer(me: PeerInfo, them: PeerInfo): boolean {
  if (me.joinedAt !== them.joinedAt) return me.joinedAt < them.joinedAt;
  return me.identity < them.identity;
}

export type SignalStatus = "connecting" | "waiting" | "paired" | "error";

export interface SignalingHandlers {
  onPeer: (peer: PeerInfo, iOffer: boolean) => void;
  onOffer: (sdp: string) => void;
  onAnswer: (sdp: string) => void;
  onIce: (candidate: RTCIceCandidateInit) => void;
}

export function useSignaling(code: string, handlers: SignalingHandlers) {
  const [status, setStatus] = useState<SignalStatus>("connecting");
  const channelRef = useRef<RealtimeChannel | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const identity = getIdentity();
    const joinedAt = Date.now();
    const me: PeerInfo = { identity, joinedAt };

    const channel = getSupabase().channel(`room:${code}`, {
      config: { broadcast: { self: false } },
    });
    channelRef.current = channel;

    channel.on("broadcast", { event: "signal" }, ({ payload }) => {
      const msg = payload as SignalMessage;
      if ("from" in msg && msg.from === identity) return;

      switch (msg.kind) {
        case "join": {
          const them = { identity: msg.identity, joinedAt: msg.joinedAt };
          setStatus("paired");
          // Re-announce so a peer who joined first learns about us too.
          channel.send({
            type: "broadcast",
            event: "signal",
            payload: { kind: "join", identity, joinedAt } satisfies SignalMessage,
          });
          handlersRef.current.onPeer(them, shouldOffer(me, them));
          break;
        }
        case "offer":
          handlersRef.current.onOffer(msg.sdp);
          break;
        case "answer":
          handlersRef.current.onAnswer(msg.sdp);
          break;
        case "ice":
          handlersRef.current.onIce(msg.candidate);
          break;
      }
    });

    channel.subscribe((s) => {
      if (s === "SUBSCRIBED") {
        setStatus("waiting");
        channel.send({
          type: "broadcast",
          event: "signal",
          payload: { kind: "join", identity, joinedAt } satisfies SignalMessage,
        });
      } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT") {
        setStatus("error");
      }
    });

    return () => {
      channel.unsubscribe();
      channelRef.current = null;
    };
  }, [code]);

  function send(msg: SignalMessage) {
    channelRef.current?.send({ type: "broadcast", event: "signal", payload: msg });
  }

  return { send, status };
}
```

Note: the `join` re-announce will make both peers call `onPeer`. `shouldOffer` guarantees only one of them creates an offer, so this is safe — but `onPeer` must be idempotent in Task 8.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- src/lib/signaling/useSignaling.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/signaling
git commit -m "feat: add Supabase Realtime signaling with deterministic glare tiebreak"
```

---

### Task 8: Peer connection and data channel

**Files:**
- Create: `src/lib/rtc/usePeerConnection.ts`
- Test: none automated — covered by Task 13 manual QA.

**Interfaces:**
- Consumes: `fetchIceServers` (Task 6), `useSignaling`/`SignalMessage`/`PeerInfo` (Task 7), `encode`/`decode`/`PeerMessage` (Task 2), `SyncedClock` (Task 3).
- Produces:
  - `type ConnState = "idle" | "connecting" | "connected" | "reconnecting" | "failed"`
  - `interface PeerApi { localStream, remoteStream, state, relayed, rtt, send(m: PeerMessage), clock, mediaError, retry() }`
  - `usePeerConnection(code: string, onMessage: (m: PeerMessage) => void): PeerApi`

**Design note:** `onPeer` fires on both peers and may fire more than once (see Task 7's re-announce). Guard offer creation with a ref so a second `onPeer` does not create a duplicate offer.

- [ ] **Step 1: Implement `src/lib/rtc/usePeerConnection.ts`**

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchIceServers } from "./iceServers";
import { decode, encode, type PeerMessage } from "./protocol";
import { SyncedClock } from "@/lib/sync/SyncedClock";
import { getIdentity } from "@/lib/history/identity";
import {
  useSignaling,
  type PeerInfo,
  type SignalMessage,
} from "@/lib/signaling/useSignaling";

export type ConnState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed";

export interface PeerApi {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  state: ConnState;
  /** True when the selected candidate pair goes through a TURN relay. */
  relayed: boolean;
  rtt: number;
  mediaError: string | null;
  clock: SyncedClock | null;
  send: (m: PeerMessage) => void;
  retry: () => void;
}

const MEDIA_CONSTRAINTS: MediaStreamConstraints = {
  video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
  audio: { echoCancellation: true, noiseSuppression: true },
};

export function usePeerConnection(
  code: string,
  onMessage: (m: PeerMessage) => void,
): PeerApi {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [state, setState] = useState<ConnState>("idle");
  const [relayed, setRelayed] = useState(false);
  const [rtt, setRtt] = useState(0);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const clockRef = useRef<SyncedClock | null>(null);
  const offeredRef = useRef(false);
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const sendSignalRef = useRef<(m: SignalMessage) => void>(() => {});

  const send = useCallback((m: PeerMessage) => {
    const dc = dcRef.current;
    if (dc?.readyState === "open") dc.send(encode(m));
  }, []);

  const wireDataChannel = useCallback((dc: RTCDataChannel) => {
    dcRef.current = dc;
    dc.onopen = () => {
      const clock = new SyncedClock({ send });
      clockRef.current = clock;
      clock.startSync();
      send({
        t: "hello",
        identity: getIdentity(),
        name: localStorage.getItem("datesidea.name") ?? "Partner",
      });
    };
    dc.onmessage = (e) => {
      const msg = decode(typeof e.data === "string" ? e.data : "");
      if (!msg) return;
      // The clock owns ping/pong; everything else goes to the app.
      if (msg.t === "ping" || msg.t === "pong") {
        clockRef.current?.handleMessage(msg);
        setRtt(clockRef.current?.rtt ?? 0);
        return;
      }
      onMessageRef.current(msg);
    };
    dc.onclose = () => {
      clockRef.current?.stop();
      clockRef.current = null;
    };
  }, [send]);

  // Acquire local media once per attempt.
  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;

    navigator.mediaDevices
      .getUserMedia(MEDIA_CONSTRAINTS)
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        setMediaError(null);
        setLocalStream(s);
      })
      .catch((err: DOMException) => {
        if (cancelled) return;
        // Join anyway: a receive-only session is better than a dead page.
        setMediaError(err.name === "NotAllowedError" ? "denied" : "unavailable");
        setLocalStream(null);
      });

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [attempt]);

  const buildConnection = useCallback(async () => {
    const { iceServers } = await fetchIceServers();
    const pc = new RTCPeerConnection({ iceServers, iceCandidatePoolSize: 4 });
    pcRef.current = pc;

    if (localStream) {
      for (const track of localStream.getTracks()) pc.addTrack(track, localStream);
    } else {
      // No camera: still negotiate receive-only transceivers.
      pc.addTransceiver("video", { direction: "recvonly" });
      pc.addTransceiver("audio", { direction: "recvonly" });
    }

    pc.ontrack = (e) => setRemoteStream(e.streams[0] ?? null);
    pc.ondatachannel = (e) => wireDataChannel(e.channel);
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        sendSignalRef.current({
          kind: "ice",
          candidate: e.candidate.toJSON(),
          from: getIdentity(),
        });
      }
    };
    pc.onconnectionstatechange = () => {
      switch (pc.connectionState) {
        case "connected":
          setState("connected");
          void reportRelayStatus(pc, setRelayed);
          break;
        case "disconnected":
          setState("reconnecting");
          break;
        case "failed":
          setState("failed");
          if (offeredRef.current) void restartIce(pc, sendSignalRef.current);
          break;
      }
    };
    return pc;
  }, [localStream, wireDataChannel]);

  const signaling = useSignaling(code, {
    onPeer: async (_peer: PeerInfo, iOffer: boolean) => {
      if (!iOffer || offeredRef.current) return;
      offeredRef.current = true;
      setState("connecting");
      const pc = pcRef.current ?? (await buildConnection());
      wireDataChannel(pc.createDataChannel("sync", { ordered: true }));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendSignalRef.current({ kind: "offer", sdp: offer.sdp!, from: getIdentity() });
    },
    onOffer: async (sdp) => {
      setState("connecting");
      const pc = pcRef.current ?? (await buildConnection());
      await pc.setRemoteDescription({ type: "offer", sdp });
      await drainIce(pc, pendingIce.current);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignalRef.current({ kind: "answer", sdp: answer.sdp!, from: getIdentity() });
    },
    onAnswer: async (sdp) => {
      const pc = pcRef.current;
      if (!pc || pc.signalingState === "stable") return;
      await pc.setRemoteDescription({ type: "answer", sdp });
      await drainIce(pc, pendingIce.current);
    },
    onIce: async (candidate) => {
      const pc = pcRef.current;
      // Candidates can arrive before the remote description; buffer them.
      if (!pc?.remoteDescription) {
        pendingIce.current.push(candidate);
        return;
      }
      await pc.addIceCandidate(candidate).catch(() => {});
    },
  });
  sendSignalRef.current = signaling.send;

  useEffect(() => {
    return () => {
      clockRef.current?.stop();
      dcRef.current?.close();
      pcRef.current?.close();
      pcRef.current = null;
      offeredRef.current = false;
    };
  }, [code, attempt]);

  const retry = useCallback(() => {
    clockRef.current?.stop();
    dcRef.current?.close();
    pcRef.current?.close();
    pcRef.current = null;
    offeredRef.current = false;
    pendingIce.current = [];
    setRemoteStream(null);
    setState("idle");
    setAttempt((a) => a + 1);
  }, []);

  return {
    localStream,
    remoteStream,
    state,
    relayed,
    rtt,
    mediaError,
    clock: clockRef.current,
    send,
    retry,
  };
}

async function drainIce(pc: RTCPeerConnection, queue: RTCIceCandidateInit[]) {
  while (queue.length) {
    const c = queue.shift()!;
    await pc.addIceCandidate(c).catch(() => {});
  }
}

async function restartIce(
  pc: RTCPeerConnection,
  sendSignal: (m: SignalMessage) => void,
) {
  const offer = await pc.createOffer({ iceRestart: true });
  await pc.setLocalDescription(offer);
  sendSignal({ kind: "offer", sdp: offer.sdp!, from: getIdentity() });
}

/** Report honestly whether media is flowing through a relay. */
async function reportRelayStatus(
  pc: RTCPeerConnection,
  setRelayed: (v: boolean) => void,
) {
  const stats = await pc.getStats();
  for (const report of stats.values()) {
    if (report.type === "candidate-pair" && report.state === "succeeded") {
      const local = stats.get(report.localCandidateId);
      setRelayed(local?.candidateType === "relay");
      return;
    }
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/rtc/usePeerConnection.ts
git commit -m "feat: add peer connection with ICE restart, relay reporting, and buffered candidates"
```

---

### Task 9: MediaPipe worker and frame pump

**Files:**
- Create: `src/lib/vision/gesture.worker.ts`
- Create: `src/lib/vision/useGestureDetection.ts`
- Test: none automated — the pure logic is covered in Task 5; model loading is covered by Task 13 manual QA.

**Interfaces:**
- Consumes: `VisionFrame`, `HandSummary` (Task 5 `types.ts`), `GestureTracker` (Task 5), `MemeId` (Task 2).
- Produces:
  - Worker messages in: `{ type: "init" } | { type: "frame"; bitmap: ImageBitmap; timestamp: number }`
  - Worker messages out: `{ type: "ready" } | { type: "error"; message: string } | { type: "frame"; frame: VisionFrame }`
  - `useGestureDetection(stream, onGesture): { ready: boolean; error: string | null }`

**MediaPipe reference:** `FaceLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath, delegate: "GPU" }, runningMode: "VIDEO", numFaces: 1, outputFaceBlendshapes: true })`. Blendshape categories include `mouthSmileLeft` and `mouthSmileRight`. `detectForVideo(image, timestampMs)` requires **strictly increasing** timestamps.

MediaPipe hand landmark indices used below: 0 wrist, 4 thumb tip, 8 index tip, 9 middle MCP, 12 middle tip, 16 ring tip, 20 pinky tip, and the PIP joints 3, 6, 10, 14, 18.

- [ ] **Step 1: Implement `src/lib/vision/gesture.worker.ts`**

```ts
/// <reference lib="webworker" />
import {
  FilesetResolver,
  FaceLandmarker,
  HandLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import type { FingerStates, HandSummary, VisionFrame } from "./types";

const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const FACE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const HAND_MODEL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

let face: FaceLandmarker | null = null;
let hands: HandLandmarker | null = null;
let lastTimestamp = -1;

async function init() {
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
  // GPU is preferred; some drivers reject it inside a worker, so fall back.
  for (const delegate of ["GPU", "CPU"] as const) {
    try {
      face = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
      });
      hands = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: HAND_MODEL, delegate },
        runningMode: "VIDEO",
        numHands: 2,
      });
      return;
    } catch {
      face = null;
      hands = null;
    }
  }
  throw new Error("MediaPipe failed to initialize on both GPU and CPU");
}

function dist(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** A finger is extended when its tip sits farther from the wrist than its PIP joint. */
function extended(
  lm: NormalizedLandmark[],
  tip: number,
  pip: number,
): boolean {
  return dist(lm[tip], lm[0]) > dist(lm[pip], lm[0]) * 1.15;
}

function summarize(
  lm: NormalizedLandmark[],
  handedness: "Left" | "Right",
): HandSummary {
  const states: FingerStates = {
    thumb: extended(lm, 4, 3),
    index: extended(lm, 8, 6),
    middle: extended(lm, 12, 10),
    ring: extended(lm, 16, 14),
    pinky: extended(lm, 20, 18),
  };
  return {
    handedness,
    extended: states,
    thumbTip: { x: lm[4].x, y: lm[4].y },
    indexTip: { x: lm[8].x, y: lm[8].y },
    wrist: { x: lm[0].x, y: lm[0].y },
    scale: dist(lm[0], lm[9]) || 0.0001,
  };
}

function smileFrom(blendshapes: { categoryName: string; score: number }[]): number {
  let best = 0;
  for (const b of blendshapes) {
    if (b.categoryName === "mouthSmileLeft" || b.categoryName === "mouthSmileRight") {
      best = Math.max(best, b.score);
    }
  }
  return best;
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;

  if (msg.type === "init") {
    try {
      await init();
      self.postMessage({ type: "ready" });
    } catch (err) {
      self.postMessage({ type: "error", message: String(err) });
    }
    return;
  }

  if (msg.type !== "frame") return;
  const bitmap = msg.bitmap as ImageBitmap;

  try {
    if (!face || !hands) return;
    // detectForVideo rejects non-increasing timestamps.
    const ts = msg.timestamp <= lastTimestamp ? lastTimestamp + 1 : msg.timestamp;
    lastTimestamp = ts;

    const faceResult = face.detectForVideo(bitmap, ts);
    const handResult = hands.detectForVideo(bitmap, ts);

    const frame: VisionFrame = {
      timestamp: ts,
      smileScore: faceResult.faceBlendshapes?.[0]
        ? smileFrom(faceResult.faceBlendshapes[0].categories)
        : 0,
      hands: handResult.landmarks.map((lm, i) =>
        summarize(
          lm,
          (handResult.handedness[i]?.[0]?.categoryName as "Left" | "Right") ?? "Right",
        ),
      ),
    };
    self.postMessage({ type: "frame", frame });
  } finally {
    // Always release: a leaked ImageBitmap at 30fps exhausts GPU memory fast.
    bitmap.close();
  }
};
```

- [ ] **Step 2: Implement `src/lib/vision/useGestureDetection.ts`**

```ts
"use client";

import { useEffect, useRef, useState } from "react";
import { GestureTracker } from "./gestures";
import type { VisionFrame } from "./types";
import type { MemeId } from "@/lib/rtc/protocol";

/**
 * Pumps frames from the local camera into the MediaPipe worker and turns the
 * results into gesture events. If the worker fails to start, gesture SENDING
 * is disabled and the session continues — the partner's memes still arrive.
 */
export function useGestureDetection(
  stream: MediaStream | null,
  onGesture: (id: MemeId) => void,
) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onGestureRef = useRef(onGesture);
  onGestureRef.current = onGesture;

  useEffect(() => {
    if (!stream || stream.getVideoTracks().length === 0) return;

    const worker = new Worker(new URL("./gesture.worker.ts", import.meta.url), {
      type: "module",
    });
    const tracker = new GestureTracker();
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;

    let stopped = false;
    let inFlight = false;
    let handle = 0;

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === "ready") {
        setReady(true);
      } else if (msg.type === "error") {
        setError(msg.message);
        setReady(false);
      } else if (msg.type === "frame") {
        inFlight = false;
        for (const id of tracker.update(msg.frame as VisionFrame)) {
          onGestureRef.current(id);
        }
      }
    };
    worker.postMessage({ type: "init" });

    const pump = async (_now: number, meta: { mediaTime: number }) => {
      if (stopped) return;
      // Drop frames while inference is busy rather than queueing behind it.
      if (!inFlight && ready) {
        inFlight = true;
        try {
          const bitmap = await createImageBitmap(video);
          worker.postMessage({ type: "frame", bitmap, timestamp: meta.mediaTime * 1000 }, [bitmap]);
        } catch {
          inFlight = false;
        }
      }
      handle = video.requestVideoFrameCallback(pump);
    };

    void video.play().then(() => {
      handle = video.requestVideoFrameCallback(pump);
    });

    return () => {
      stopped = true;
      if (handle) video.cancelVideoFrameCallback(handle);
      video.srcObject = null;
      worker.terminate();
    };
  }, [stream, ready]);

  return { ready, error };
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors. If `requestVideoFrameCallback` is missing from the DOM lib, add to `src/lib/vision/useGestureDetection.ts`:

```ts
declare global {
  interface HTMLVideoElement {
    requestVideoFrameCallback(cb: (now: number, meta: { mediaTime: number }) => void): number;
    cancelVideoFrameCallback(handle: number): void;
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/vision/gesture.worker.ts src/lib/vision/useGestureDetection.ts
git commit -m "feat: run MediaPipe in a worker with frame-drop backpressure"
```

---

### Task 10: History persistence

**Files:**
- Create: `supabase/migrations/0001_init.sql`
- Create: `src/lib/history/useSession.ts`
- Create: `src/lib/history/aggregate.ts`
- Test: `src/lib/history/aggregate.test.ts`

**Interfaces:**
- Consumes: `getSupabase` (Task 7), `getIdentity` (Task 4), `MemeId` (Task 2).
- Produces:
  - `class MemeCounter` with `record(id)`, `snapshot(): Record<string, number>`, `total: number`
  - `formatDuration(ms: number): string`
  - `useSession(code, enabled): { recordMeme(id), sessionId }`
  - `listSessions(code): Promise<SessionRow[]>`

- [ ] **Step 1: Write the failing test**

Create `src/lib/history/aggregate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { MemeCounter, formatDuration } from "./aggregate";

describe("MemeCounter", () => {
  it("starts empty", () => {
    const c = new MemeCounter();
    expect(c.snapshot()).toEqual({});
    expect(c.total).toBe(0);
  });

  it("accumulates per meme id", () => {
    const c = new MemeCounter();
    c.record("heart");
    c.record("heart");
    c.record("peace");
    expect(c.snapshot()).toEqual({ heart: 2, peace: 1 });
    expect(c.total).toBe(3);
  });

  it("returns a copy so callers cannot mutate internal state", () => {
    const c = new MemeCounter();
    c.record("smile");
    const snap = c.snapshot();
    snap.smile = 999;
    expect(c.snapshot()).toEqual({ smile: 1 });
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "0m"],
    [45_000, "0m"],
    [60_000, "1m"],
    [3_600_000, "1h 0m"],
    [5_400_000, "1h 30m"],
    [7_320_000, "2h 2m"],
  ])("formats %ims as %s", (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/history/aggregate.test.ts`
Expected: FAIL — cannot resolve `./aggregate`.

- [ ] **Step 3: Implement `src/lib/history/aggregate.ts`**

```ts
import type { MemeId } from "@/lib/rtc/protocol";

/**
 * Accumulates meme counts in memory. Flushed once at session end — writing
 * per gesture would put a network round trip on the hot path.
 */
export class MemeCounter {
  private counts = new Map<MemeId, number>();

  record(id: MemeId): void {
    this.counts.set(id, (this.counts.get(id) ?? 0) + 1);
  }

  get total(): number {
    let n = 0;
    for (const v of this.counts.values()) n += v;
    return n;
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.counts);
  }
}

export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/history/aggregate.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Create `supabase/migrations/0001_init.sql`**

```sql
create table if not exists couples (
  code        text primary key,
  created_at  timestamptz not null default now()
);

create table if not exists sessions (
  id          uuid primary key default gen_random_uuid(),
  couple_code text not null references couples(code) on delete cascade,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  memes_sent  jsonb not null default '{}'::jsonb
);

create table if not exists participants (
  session_id  uuid not null references sessions(id) on delete cascade,
  identity    uuid not null,
  name        text,
  primary key (session_id, identity)
);

create index if not exists sessions_by_couple
  on sessions (couple_code, started_at desc);

alter table couples      enable row level security;
alter table sessions     enable row level security;
alter table participants enable row level security;

-- The room code is the capability. Knowing it is the authorization; there are
-- no accounts. Codes are 6 chars from a 31-symbol alphabet (~887M values),
-- which is adequate for a two-person app and nothing more.
create policy couples_anon_all on couples
  for all to anon using (true) with check (true);

create policy sessions_anon_all on sessions
  for all to anon using (true) with check (true);

create policy participants_anon_all on participants
  for all to anon using (true) with check (true);
```

- [ ] **Step 6: Implement `src/lib/history/useSession.ts`**

```ts
"use client";

import { useCallback, useEffect, useRef } from "react";
import { getSupabase } from "@/lib/signaling/supabaseClient";
import { getIdentity, getDisplayName } from "./identity";
import { MemeCounter } from "./aggregate";
import type { MemeId } from "@/lib/rtc/protocol";

export interface SessionRow {
  id: string;
  started_at: string;
  ended_at: string | null;
  memes_sent: Record<string, number>;
}

export async function listSessions(code: string): Promise<SessionRow[]> {
  const { data, error } = await getSupabase()
    .from("sessions")
    .select("id, started_at, ended_at, memes_sent")
    .eq("couple_code", code)
    .not("ended_at", "is", null)
    .order("started_at", { ascending: false })
    .limit(50);
  if (error) return [];
  return (data ?? []) as SessionRow[];
}

/**
 * Opens a session row when the call connects and closes it on unload.
 * Meme counts accumulate locally and flush exactly once, at the end.
 */
export function useSession(code: string, connected: boolean) {
  const counter = useRef(new MemeCounter());
  const sessionId = useRef<string | null>(null);

  const recordMeme = useCallback((id: MemeId) => {
    counter.current.record(id);
  }, []);

  useEffect(() => {
    if (!connected) return;
    const sb = getSupabase();
    let cancelled = false;

    void (async () => {
      await sb.from("couples").upsert({ code }, { onConflict: "code" });
      const { data } = await sb
        .from("sessions")
        .insert({ couple_code: code })
        .select("id")
        .single();
      if (cancelled || !data) return;
      sessionId.current = data.id as string;
      await sb.from("participants").upsert({
        session_id: data.id,
        identity: getIdentity(),
        name: getDisplayName(),
      });
    })();

    const close = () => {
      const id = sessionId.current;
      if (!id) return;
      sessionId.current = null;
      void sb
        .from("sessions")
        .update({
          ended_at: new Date().toISOString(),
          memes_sent: counter.current.snapshot(),
        })
        .eq("id", id);
    };

    window.addEventListener("beforeunload", close);
    return () => {
      cancelled = true;
      window.removeEventListener("beforeunload", close);
      close();
    };
  }, [code, connected]);

  return { recordMeme, sessionId: sessionId.current };
}
```

- [ ] **Step 7: Verify it compiles and tests pass**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; all tests pass.

- [ ] **Step 8: Commit**

```bash
git add supabase src/lib/history
git commit -m "feat: add session history with end-of-session meme aggregation"
```

---

### Task 11: UI components

**Files:**
- Create: `src/components/VideoStage.tsx`
- Create: `src/components/MemeOverlay.tsx`
- Create: `src/components/ConnectionStatus.tsx`
- Create: `src/components/RoomGate.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `MemeId` (Task 2), `ConnState` (Task 8).
- Produces:
  - `<VideoStage local remote localMuted mediaError />`
  - `type ActiveMeme = { key: number; id: MemeId; side: "local" | "remote" }`
  - `<MemeOverlay memes side />`
  - `<ConnectionStatus state relayed rtt gestureReady gestureError />`
  - `<RoomGate code status onJoin />`

**Before writing these components, invoke the `frontend-design:frontend-design` skill**, and execute it against the **Visual Direction — La La Land** section in Global Constraints above. That section fixes palette, monogram, type feel, and restraint rules; the skill's job is to turn them into a specific, non-templated execution — exact type scale, exact gradient stops, exact spacing rhythm.

Two additional files belong to this task:

- Create: `src/components/Ambience.tsx` — the starfield, dusk-gradient wash, and grain overlay. One component, `pointer-events-none`, used by both pages so they cannot drift apart.
- Create: `src/components/Monogram.tsx` — the `M + K` wordmark, with a `size` prop (`"hero"` for the homepage, `"compact"` for the call-page header).

What this plan fixes is the *behavior*, listed below. Do not let the design pass change any of it:

- Both video tiles are always rendered, even before the remote stream arrives; the remote tile shows a waiting state rather than collapsing the layout.
- The local tile is mirrored (`transform: scaleX(-1)`), the remote tile is not. Mirroring the remote view would make your partner's gestures read backwards.
- The local tile is always `muted` — unmuted local audio causes feedback howl.
- Meme overlays are absolutely positioned within their own tile, never over the whole stage.
- `ConnectionStatus` states relay honestly: when `relayed` is true it must say so, never imply a direct link.
- When `mediaError === "denied"`, the local tile shows an explanatory state — the page must not look broken.
- `Ambience` renders behind everything on both pages and must never intercept a click.
- The `M + K` monogram is present on both pages — hero size on the homepage, compact in the call-page header.
- Video tiles keep a neutral dark ground (`bg-neutral-900` or a near-black from the palette). Do not tint the tile itself with the gradient — the restraint rule.
- Under `prefers-reduced-motion`, the starfield and grain hold still and the ambient gradient stops animating.

The component code blocks in Steps 2–5 below are **behavioral scaffolds with placeholder styling**. Keep every prop, ref, effect, and conditional exactly as written; replace the Tailwind class strings with the themed execution the design skill produces.

- [ ] **Step 1: Invoke the frontend-design skill**

Use the `frontend-design:frontend-design` skill to establish typography, palette, and visual direction before writing any component. Record the chosen direction as a comment block at the top of `globals.css` so later tasks stay consistent.

- [ ] **Step 2: Implement `src/components/MemeOverlay.tsx`**

```tsx
"use client";

import { AnimatePresence, motion } from "motion/react";
import type { MemeId } from "@/lib/rtc/protocol";

export interface ActiveMeme {
  key: number;
  id: MemeId;
}

const EMOJI: Record<MemeId, string> = {
  heart: "💖",
  peace: "✌️",
  thumbsUp: "👍",
  smile: "😄",
};

export function MemeOverlay({ memes }: { memes: ActiveMeme[] }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <AnimatePresence>
        {memes.map((m) => (
          <motion.div
            key={m.key}
            initial={{ opacity: 0, scale: 0.3, y: 40 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 1.6, y: -60 }}
            transition={{ type: "spring", stiffness: 320, damping: 22 }}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-8xl select-none"
          >
            {EMOJI[m.id]}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
```

- [ ] **Step 3: Implement `src/components/VideoStage.tsx`**

```tsx
"use client";

import { useEffect, useRef } from "react";
import { MemeOverlay, type ActiveMeme } from "./MemeOverlay";

function Tile({
  stream,
  mirrored,
  muted,
  label,
  memes,
  placeholder,
}: {
  stream: MediaStream | null;
  mirrored: boolean;
  muted: boolean;
  label: string;
  memes: ActiveMeme[];
  placeholder: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-neutral-900">
      {stream ? (
        <video
          ref={ref}
          autoPlay
          playsInline
          muted={muted}
          className="h-full w-full object-cover"
          style={mirrored ? { transform: "scaleX(-1)" } : undefined}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center px-6 text-center text-sm text-neutral-400">
          {placeholder}
        </div>
      )}
      <MemeOverlay memes={memes} />
      <span className="absolute bottom-3 left-3 rounded-full bg-black/60 px-3 py-1 text-xs text-white">
        {label}
      </span>
    </div>
  );
}

export function VideoStage({
  local,
  remote,
  localMemes,
  remoteMemes,
  mediaError,
}: {
  local: MediaStream | null;
  remote: MediaStream | null;
  localMemes: ActiveMeme[];
  remoteMemes: ActiveMeme[];
  mediaError: string | null;
}) {
  return (
    <div className="grid w-full gap-4 md:grid-cols-2">
      <Tile
        stream={local}
        mirrored
        muted
        label="You"
        memes={localMemes}
        placeholder={
          mediaError === "denied"
            ? "Camera access is blocked. You can still see and hear your partner — allow the camera in your browser settings to send video."
            : "Starting your camera…"
        }
      />
      <Tile
        stream={remote}
        mirrored={false}
        muted={false}
        label="Them"
        memes={remoteMemes}
        placeholder="Waiting for your partner to join…"
      />
    </div>
  );
}
```

- [ ] **Step 4: Implement `src/components/ConnectionStatus.tsx`**

```tsx
"use client";

import type { ConnState } from "@/lib/rtc/usePeerConnection";

const LABEL: Record<ConnState, string> = {
  idle: "Getting ready",
  connecting: "Connecting",
  connected: "Connected",
  reconnecting: "Reconnecting",
  failed: "Connection failed",
};

export function ConnectionStatus({
  state,
  relayed,
  rtt,
  gestureReady,
  gestureError,
  onRetry,
}: {
  state: ConnState;
  relayed: boolean;
  rtt: number;
  gestureReady: boolean;
  gestureError: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-400">
      <span className="font-medium text-neutral-200">{LABEL[state]}</span>

      {state === "connected" && rtt > 0 && <span>{Math.round(rtt)}ms round trip</span>}

      {/* Honest about the relay: never imply a direct link when there isn't one. */}
      {state === "connected" && relayed && <span>via relay</span>}

      {gestureError ? (
        <span>Gestures unavailable on this device — you&apos;ll still see theirs</span>
      ) : gestureReady ? (
        <span>Gestures on</span>
      ) : (
        <span>Loading gestures…</span>
      )}

      {state === "failed" && (
        <button onClick={onRetry} className="underline underline-offset-2">
          Try again
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Implement `src/components/RoomGate.tsx`**

```tsx
"use client";

import { useState } from "react";
import { isValidRoomCode } from "@/lib/room/code";

export function RoomGate({
  onJoin,
  onCreate,
}: {
  onJoin: (code: string) => void;
  onCreate: () => void;
}) {
  const [value, setValue] = useState("");
  const valid = isValidRoomCode(value);

  return (
    <div className="flex flex-col gap-4">
      <button onClick={onCreate} className="rounded-xl bg-neutral-100 px-5 py-3 text-neutral-900">
        Start a new room
      </button>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onJoin(value.toUpperCase());
        }}
        className="flex gap-2"
      >
        <input
          value={value}
          onChange={(e) => setValue(e.target.value.toUpperCase())}
          placeholder="Enter a code"
          maxLength={6}
          className="flex-1 rounded-xl bg-neutral-900 px-4 py-3 tracking-[0.3em] uppercase"
        />
        <button
          type="submit"
          disabled={!valid}
          className="rounded-xl px-5 py-3 disabled:opacity-40"
        >
          Join
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 6: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components src/app/globals.css
git commit -m "feat: add video stage, meme overlay, connection status, and room gate"
```

---

### Task 12: Page wiring

**Files:**
- Modify: `src/app/page.tsx`
- Create: `src/app/room/[code]/page.tsx`
- Create: `src/app/room/[code]/RoomClient.tsx`

**Interfaces:**
- Consumes: everything from Tasks 3–11.
- Produces: a working end-to-end room.

Both pages render `<Ambience />` and `<Monogram />` per the Visual Direction. The homepage
is the fuller expression of the theme — hero monogram, dusk gradient, starfield — while the
call page carries a restrained version that never competes with the video.

**This is where the "both screens at the identical instant" rule becomes code.** The sender must schedule its own render through `clock.scheduleAt` — it must not render immediately.

- [ ] **Step 1: Implement `src/app/room/[code]/page.tsx`**

```tsx
import { RoomClient } from "./RoomClient";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <RoomClient code={code.toUpperCase()} />;
}
```

- [ ] **Step 2: Implement `src/app/room/[code]/RoomClient.tsx`**

```tsx
"use client";

import { useCallback, useRef, useState } from "react";
import { usePeerConnection } from "@/lib/rtc/usePeerConnection";
import { useGestureDetection } from "@/lib/vision/useGestureDetection";
import { useSession } from "@/lib/history/useSession";
import { VideoStage } from "@/components/VideoStage";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import type { ActiveMeme } from "@/components/MemeOverlay";
import type { MemeId, PeerMessage } from "@/lib/rtc/protocol";

const MEME_LIFETIME_MS = 2200;

export function RoomClient({ code }: { code: string }) {
  const [localMemes, setLocalMemes] = useState<ActiveMeme[]>([]);
  const [remoteMemes, setRemoteMemes] = useState<ActiveMeme[]>([]);
  const keyRef = useRef(0);

  const show = useCallback((id: MemeId, side: "local" | "remote") => {
    const key = keyRef.current++;
    const setter = side === "local" ? setLocalMemes : setRemoteMemes;
    setter((cur) => [...cur, { key, id }]);
    setTimeout(() => setter((cur) => cur.filter((m) => m.key !== key)), MEME_LIFETIME_MS);
  }, []);

  const onMessage = useCallback(
    (msg: PeerMessage) => {
      if (msg.t !== "meme") return;
      // Scheduled, not immediate: both screens land on the same instant.
      peer.clock?.scheduleAt(msg.showAt, () => show(msg.id, "remote"));
    },
    // `peer` is defined below; this closure only runs after render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [show],
  );

  const peer = usePeerConnection(code, onMessage);
  const session = useSession(code, peer.state === "connected");

  const onGesture = useCallback(
    (id: MemeId) => {
      const clock = peer.clock;
      if (!clock) return;
      const showAt = clock.now() + clock.leadTime();
      peer.send({ t: "meme", id, showAt });
      // The sender schedules too. Rendering now would be faster but would
      // break the symmetry the design requires.
      clock.scheduleAt(showAt, () => show(id, "local"));
      session.recordMeme(id);
    },
    [peer, session, show],
  );

  const gesture = useGestureDetection(peer.localStream, onGesture);

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-5 p-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-medium">DatesIdea</h1>
        <code className="tracking-[0.3em] text-sm text-neutral-400">{code}</code>
      </header>

      <VideoStage
        local={peer.localStream}
        remote={peer.remoteStream}
        localMemes={localMemes}
        remoteMemes={remoteMemes}
        mediaError={peer.mediaError}
      />

      <ConnectionStatus
        state={peer.state}
        relayed={peer.relayed}
        rtt={peer.rtt}
        gestureReady={gesture.ready}
        gestureError={gesture.error}
        onRetry={peer.retry}
      />
    </main>
  );
}
```

- [ ] **Step 3: Implement `src/app/page.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RoomGate } from "@/components/RoomGate";
import { newRoomCode } from "@/lib/room/code";
import { getSavedRoom, saveRoom } from "@/lib/history/identity";
import { listSessions, type SessionRow } from "@/lib/history/useSession";
import { formatDuration } from "@/lib/history/aggregate";

export default function Home() {
  const router = useRouter();
  const [saved, setSaved] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);

  useEffect(() => {
    const code = getSavedRoom();
    setSaved(code);
    if (code) void listSessions(code).then(setSessions);
  }, []);

  function go(code: string) {
    saveRoom(code);
    router.push(`/room/${code}`);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 p-6">
      <h1 className="text-2xl font-medium">DatesIdea</h1>

      {saved && (
        <button
          onClick={() => go(saved)}
          className="rounded-xl bg-neutral-100 px-5 py-3 text-neutral-900"
        >
          Rejoin {saved}
        </button>
      )}

      <RoomGate onJoin={go} onCreate={() => go(newRoomCode())} />

      {sessions.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm text-neutral-400">Past dates</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {sessions.map((s) => {
              const total = Object.values(s.memes_sent).reduce((a, b) => a + b, 0);
              const ms = s.ended_at
                ? new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()
                : 0;
              return (
                <li key={s.id} className="flex justify-between text-neutral-300">
                  <span>{new Date(s.started_at).toLocaleDateString()}</span>
                  <span className="text-neutral-500">
                    {formatDuration(ms)} · {total} reactions
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Verify the whole project builds and tests pass**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run build`
Expected: all four succeed.

- [ ] **Step 5: Commit**

```bash
git add src/app
git commit -m "feat: wire the room end to end with symmetric meme scheduling"
```

---

### Task 13: Deployment and manual verification

**Files:**
- Create: `README.md` (replace the create-next-app default)
- Create: `docs/manual-qa.md`

**Interfaces:** none — this task produces documentation and a verified deployment.

**This task cannot be completed by an agent alone.** Steps 1–3 require the user's Supabase, Cloudflare, and Vercel accounts. An agent executing this plan should complete Steps 4–6 and then hand the checklist to the user.

- [ ] **Step 1: Provision Supabase** *(user)*

Create a project in a region between the two participants. Run `supabase/migrations/0001_init.sql` in the SQL editor. Copy the project URL and anon key.

- [ ] **Step 2: Provision Cloudflare TURN** *(user)*

In the Cloudflare dashboard, open Realtime → TURN and create a key. Record the Key ID and API token.

- [ ] **Step 3: Configure and deploy** *(user)*

Set in Vercel project settings:
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `CLOUDFLARE_TURN_KEY_ID`, `CLOUDFLARE_TURN_API_TOKEN` (no `NEXT_PUBLIC_` prefix — these must stay server-side)

Then `vercel --prod`.

- [ ] **Step 4: Write `docs/manual-qa.md`**

```markdown
# Manual QA — v1

ICE negotiation cannot be meaningfully unit-tested, so these run by hand
against the deployed URL. Two machines on different networks; one on mobile
tethering exercises the relay path realistically.

## Connection
- [ ] Cold connect: both open `/room/<code>`, video and audio flow both ways
- [ ] Status shows a round-trip figure consistent with the physical distance
- [ ] Refresh one side: the session re-establishes without touching the other
- [ ] Both open the link within the same second: exactly one offer is made,
      the call connects (glare tiebreak)
- [ ] Force relay by tethering one peer to mobile data: status says "via relay"
- [ ] Kill wifi mid-call for ~10s: status goes to reconnecting, then recovers

## Media
- [ ] Deny camera on one side: that side still hears and sees the partner,
      the tile explains why it is empty, the page does not look broken
- [ ] Local tile is mirrored; remote tile is not
- [ ] No audio feedback howl (local tile must be muted)

## Gestures
- [ ] Each of heart, peace, thumbs up, smile fires within ~1s of holding it
- [ ] Holding a gesture for 10s fires it once, not repeatedly
- [ ] Repeating a gesture immediately does not re-fire inside the 3s cooldown
- [ ] A meme appears over the correct person's tile on BOTH screens
- [ ] Both screens show the meme at visibly the same moment
- [ ] With gestures blocked on one side, that side still receives the other's

## History
- [ ] After a session ends, it appears on `/` with a plausible duration
- [ ] Reaction totals match roughly what was triggered
- [ ] Meme counts are written once at session end, not per gesture
      (check the Supabase logs — one UPDATE per session)
```

- [ ] **Step 5: Write `README.md`**

Cover: what the app is, the two-person constraint, local setup (`npm install`, `.env.local` from the example, `npm run dev`), the note that cross-machine testing needs the deployed URL because `localhost` is a secure context only on one machine, `npm test`, and a link to the spec and this plan.

- [ ] **Step 6: Commit**

```bash
git add README.md docs/manual-qa.md
git commit -m "docs: add setup guide and manual QA checklist"
```

---

## Self-Review Record

**Spec coverage:** §3.1 stack → Task 1. §3.2 layout → Tasks 2–12. §4 pairing/glare → Tasks 4, 7. §5 TURN → Task 6. §6 SyncedClock → Task 3. §7 gesture pipeline → Tasks 5, 9, 12. §7.4 symmetric rendering → Task 12 Step 2. §7.5 degradation → Tasks 8, 9, 11. §8 history → Task 10. §9 protocol → Task 2. §10 failure table → Tasks 6, 8, 9, 11. §11 testing → Tasks 2–6, 10, 13. §12 deployment → Task 13.

**Type consistency:** `MemeId` originates in Task 2 and is imported everywhere. `VisionFrame`/`HandSummary` originate in Task 5 `types.ts`, consumed by Task 9. `ConnState` originates in Task 8, consumed by Task 11. `ActiveMeme` originates in Task 11 `MemeOverlay.tsx`, consumed by `VideoStage` and Task 12. `FALLBACK_ICE_SERVERS` is defined in both `route.ts` and `iceServers.ts` — intentional, since the route runs on the edge runtime and must not import client code.

**Known gap accepted:** `usePeerConnection` (Task 8) and `useGestureDetection` (Task 9) have no automated tests. Both are thin adapters over browser APIs that cannot be faithfully simulated in jsdom; their logic-bearing parts (`shouldOffer`, `SyncedClock`, `GestureTracker`, `detectRaw`) are extracted and fully tested. Task 13's checklist covers the rest.
