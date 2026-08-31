# DatesIdea — v1 Foundation Design

**Date:** 2026-08-31
**Status:** Approved
**Scope:** v1 only (P2P foundation + gesture memes + history). v2–v5 sketched for context.

---

## 1. Purpose

A private, two-person web app for long-distance date nights. Exactly two participants,
ever. Video and audio travel peer-to-peer; a shared timebase lets both browsers act at
the same real-world moment; client-side ML turns hand and face gestures into meme
overlays on both screens.

## 2. Constraints (established, not assumed)

| Constraint | Value | Consequence |
|---|---|---|
| Participants | Exactly 2 | No SFU. Raw P2P WebRTC. |
| Distance | Intercontinental (Asia ↔ US/EU) | ~180–220ms RTT floor. Design target is **one-way media latency 90–110ms**, not sub-100ms RTT. |
| Devices | Laptop/desktop both sides | Full ML budget: both MediaPipe models at 30fps, GPU delegate. |
| Movie source | Local file, both sides | No DRM problem, no bandwidth cost. Only timestamps cross the wire. |
| Photos (v3) | Download locally only | No photo storage in v1–v3 schema, but leave room. |
| History | Required | Neon Postgres session log. Auth-free. |
| Host | Vercel | Serverless: **cannot** hold WebSockets. Signalling is a polled Postgres table. |

### 2.1 Non-goals for v1

No text chat, no recording, no >2 peers, no mobile layout, no PWA, no push
notifications, no passwords. Each is cheap to add later; each would slow v1 now.

---

## 3. Architecture

### 3.1 Stack

- **Frontend:** Next.js 16 (App Router, `src/`, TypeScript), Tailwind v4, Framer Motion.
- **Signalling:** a polled `signals` table, via Next.js route handlers.
- **History:** Neon Lakebase Postgres, via Next.js route handlers.
- **TURN:** Cloudflare Calls, ephemeral credentials minted server-side.
- **ML:** `@mediapipe/tasks-vision` in a Web Worker, GPU delegate.
- **Transport:** `RTCPeerConnection` + a single ordered `RTCDataChannel`.

Media never touches a server. Server-side code is limited to four route handlers: one
mints TURN credentials, one relays the handshake, and two record history.

**Why not a realtime channel.** Neon is Postgres, not a pub/sub bus. It offers a
WebSocket-capable Functions runtime, but that is public beta, restricted to `us-east-2`,
and runs several isolates in parallel — so two peers can land on different isolates and
never see each other, a failure that does not reproduce locally. For a handshake of four
messages over a few seconds, a polled table is both simpler and more robust. Polling runs
at 500ms while pairing and drops to 5s once connected, kept only for ICE restart.

### 3.2 File layout

```
src/
  app/
    page.tsx                      # create / resume the couple room
    room/[code]/page.tsx          # the date room
    api/turn/route.ts             # mints short-lived TURN credentials
    api/signal/route.ts           # post + poll handshake messages
    api/sessions/route.ts         # list and open sessions
    api/sessions/close/route.ts   # close a session (sendBeacon target)
  lib/
    db.ts                         # Neon client, server-only
    signaling/
      useSignaling.ts             # polls /api/signal; offer/answer/ICE exchange
    rtc/
      usePeerConnection.ts        # RTCPeerConnection lifecycle + ICE restart
      useDataChannel.ts           # typed send/receive over protocol.ts
      protocol.ts                 # discriminated union of ALL message types
      iceServers.ts               # STUN list + /api/turn fetch
    sync/
      SyncedClock.ts              # NTP-style offset handshake
      scheduleAt.ts               # fire fn at a shared timestamp
    vision/
      gesture.worker.ts           # MediaPipe, off the main thread
      useGestureDetection.ts      # frame pump + worker bridge
      gestures.ts                 # threshold + hysteresis logic (pure)
    history/
      useSession.ts               # session lifecycle -> route handlers
      identity.ts                 # device-local identity token
  components/
    VideoStage.tsx                # side-by-side local + remote
    MemeOverlay.tsx               # Framer Motion overlay layer
    ConnectionStatus.tsx          # ICE state, RTT, relay indicator
    RoomGate.tsx                  # code entry / waiting-for-partner
```

`protocol.ts` is load-bearing: every future feature adds one variant to the union, and
TypeScript then flags every unhandled site. This is what keeps v2–v5 cheap.

---

## 4. Pairing and rooms

### 4.1 Flow

1. A opens `/`. If no room is stored locally, one is created: a 6-character code
   (nanoid, unambiguous alphabet — no `0/O`, `1/I/l`). Stored in `localStorage`.
2. A navigates to `/room/ABC123` and posts a `join` row, then begins polling.
3. B opens the same URL and posts its own `join`. Each sees the other's row.
4. Offer / answer / trickled ICE candidates are written as rows and polled for.
5. On `connectionstate === "connected"`, polling drops to a 5s heartbeat kept
   only so an ICE restart can be negotiated.

### 4.2 Why no auth

Two people. A code in a URL that they text each other **is** the auth story. Adding
real accounts would mean a user table, email flows, and password reset — all ceremony
for a two-person app. Identity for history is a `localStorage` UUID plus a display name.

### 4.3 Glare

If both peers join within the same tick, both would create an offer and deadlock.
**Tiebreak: the peer with the earlier channel-join timestamp is the offerer.** Ties
broken by lexicographic comparison of identity UUID. Deterministic, no retry loop.

---

## 5. TURN

Intercontinental links hit symmetric NAT and CGNAT often enough that STUN alone will
strand some sessions. Cloudflare Calls TURN credentials are short-lived and require a
secret, so they must be minted server-side.

`GET /api/turn` returns `{ iceServers: [...] }` with ~2h TTL credentials. The API token
lives in a Vercel environment variable and is never shipped to the client.

The UI reports relay honestly: when the selected candidate pair is `relay`, show
"connected via relay" rather than implying a direct link.

---

## 6. SyncedClock

### 6.1 Algorithm

Standard NTP-style offset estimation over the DataChannel:

1. Initiator sends `ping{t0}` where `t0 = Date.now()`.
2. Peer replies `pong{t0, t1}` where `t1` is the peer's `Date.now()` on receipt.
3. Initiator records `t2` on receipt.
4. `rtt = t2 - t0`; `offset = t1 - (t0 + rtt / 2)`.

Run **7 samples** and keep the offset from the sample with the **minimum RTT** — not
the mean. The minimum-RTT sample is the one least polluted by queueing jitter; averaging
actively degrades the estimate. Re-sync every 30s to correct drift.

### 6.2 API

```ts
clock.now(): number            // Date.now() + offset — shared timebase
clock.rtt: number              // last measured minimum RTT
clock.oneWay: number           // rtt / 2
clock.scheduleAt(t, fn): void  // setTimeout(fn, t - now())
clock.leadTime(): number       // oneWay + 50ms buffer
```

`scheduleAt` with a target already in the past fires immediately and increments a
`lateFires` counter surfaced in `ConnectionStatus` — silent lateness is the failure mode
that makes sync bugs impossible to diagnose.

### 6.3 Who uses it

- **v1 memes:** scheduled at `clock.now() + clock.leadTime()` (~150ms).
- **v3 photo booth:** countdown and shutter.
- **v4 movie sync:** play / pause / seek.
- **v5 karaoke:** line highlight timing.

---

## 7. Gesture → meme pipeline

### 7.1 Frame pump

Local `<video>` → `requestVideoFrameCallback` (fires once per actual decoded video
frame, unlike `requestAnimationFrame` which fires per repaint and causes duplicate or
skipped inference) → `createImageBitmap` → `postMessage` with the bitmap as a
**transferable** (zero-copy) → worker.

### 7.2 Worker

`gesture.worker.ts` runs MediaPipe `FaceLandmarker` and `HandLandmarker` with the GPU
delegate. It returns a **compact summary** — a handful of derived scalars — never the
full 478-point face mesh. Posting full landmark arrays 30x/second would cost more in
serialization than the inference saves.

### 7.3 Detection logic (`gestures.ts`, pure and unit-tested)

Four gestures in v1:

| Gesture | Signal |
|---|---|
| Heart hands | Both hands present; thumb tips and index tips converging below a distance threshold, hands adjacent |
| Peace | Index + middle extended, ring + pinky curled |
| Thumbs up | Thumb extended and vertical, other four curled |
| Big smile | `mouthSmileLeft` / `mouthSmileRight` ARKit blendshape score above threshold |

MediaPipe's `FaceLandmarker` emits 52 ARKit-style blendshapes when
`outputFaceBlendshapes: true`. Reading `mouthSmileLeft/Right` is more robust than
deriving mouth geometry from raw landmarks and removes an entire class of
normalization bug — use it rather than hand-rolling the smile metric.

Hand distances are normalized by a per-hand scale reference (wrist to middle-finger MCP)
so thresholds hold regardless of how close someone sits to the camera.

**Hysteresis is mandatory.** A raw threshold fires ~30x/second and turns the screen into
a strobe. Rules: gesture must hold **300ms continuously** to fire, then a **3s cooldown**
before the same gesture can fire again. Enter and exit thresholds differ (exit is looser)
to stop flicker at the boundary.

### 7.4 Rendering — symmetric, per the approved decision

Memes render at the **same instant on both screens**, achieved without paying the full
round-trip:

1. Gesture fires locally at `T`.
2. Sender computes `showAt = clock.now() + clock.leadTime()` and sends
   `{ t: "meme", id, showAt }`.
3. **Both** peers call `clock.scheduleAt(showAt, render)`. The sender schedules it too
   rather than rendering immediately.

Cost: ~150ms from gesture to render, both screens identical. A naive "schedule a full
RTT ahead" design would cost ~400ms; rendering optimistically would cost 0ms locally but
break symmetry. This is the middle path.

The overlay is anchored to **whoever made the gesture** — your heart appears over your
own tile on both screens. Framer Motion handles enter/exit.

### 7.5 Degradation

If MediaPipe fails to initialize (old GPU, blocked WASM), gesture *sending* is disabled
and the UI says so. Receiving the partner's memes still works. A one-sided failure must
never break the session.

---

## 8. History

### 8.1 Schema

```sql
create table couples (
  code        text primary key,
  created_at  timestamptz not null default now()
);

create table sessions (
  id          uuid primary key default gen_random_uuid(),
  couple_code text not null references couples(code),
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  memes_sent  jsonb not null default '{}'::jsonb
);

-- Handshake transport. Rows live seconds and are swept after 15 minutes.
create table signals (
  id            bigserial primary key,
  room_code     text not null,
  from_identity uuid not null,
  payload       jsonb not null,
  created_at    timestamptz not null default now()
);

create table participants (
  session_id  uuid not null references sessions(id) on delete cascade,
  identity    uuid not null,
  name        text,
  primary key (session_id, identity)
);
```

`memes_sent` as `jsonb` keeps the counter set open — v2–v5 add card draws and photo
counts without a migration. `participants.identity` is a device-local UUID, not an
account.

### 8.2 Writes

Session row created on `connected`, updated on disconnect or `beforeunload`. Meme
counts are accumulated client-side and flushed once at session end — **not** per meme.
A write per gesture would be both wasteful and a latency risk on the hot path.

### 8.3 Reads

`/` shows a simple list of past sessions: date, duration, meme totals. That is the whole
v1 history surface. Photo gallery is deliberately deferred to v3.

### 8.4 Security

The browser never reaches Postgres. `DATABASE_URL` is a server secret read only inside
route handlers, and `src/lib/db.ts` imports `server-only` so a client import fails the
build. There is therefore no RLS and no anon role — the authorization boundary is the
route handler, which validates the room code and identity shape on every request.

The room code remains the capability: knowing it is what grants access.

---

## 9. Protocol

```ts
// src/lib/rtc/protocol.ts
export type MemeId = "heart" | "peace" | "thumbsUp" | "smile";

export type PeerMessage =
  | { t: "hello";  identity: string; name: string }
  | { t: "ping";   t0: number }
  | { t: "pong";   t0: number; t1: number }
  | { t: "meme";   id: MemeId; showAt: number };
```

Single ordered, reliable DataChannel for v1. If v4 movie-seek traffic ever competes with
control messages, a second unordered channel can be added — not before.

---

## 10. Failure handling

| Failure | Behavior |
|---|---|
| Direct P2P blocked | Automatic TURN fallback; UI shows "connected via relay" |
| Peer drops | `connectionstatechange` → `disconnected`; ICE restart; "reconnecting" state |
| Camera/mic denied | Join anyway, audio-only or receive-only; never hard-fail |
| MediaPipe unavailable | Disable gesture sending; still receive partner's memes |
| Simultaneous join (glare) | Earlier join timestamp is the offerer; UUID lexicographic tiebreak |
| Signalling route fails | Poll retries on the next tick; sustained failure shows an error with a retry button |
| Clock samples all high-jitter | Use best available sample; surface a warning in status UI |

---

## 11. Testing

Test-first for the three pure modules — they carry the subtle logic and are fully
deterministic:

1. **`SyncedClock` offset selection** — synthetic sample sets with known injected
   jitter; assert the minimum-RTT sample is chosen and the offset is within tolerance.
   Include an asymmetric-path case where averaging would give the wrong answer.
2. **`gestures.ts` thresholds** — recorded landmark fixtures per gesture, plus
   hysteresis cases: below-hold-time must not fire; within-cooldown must not re-fire;
   boundary flicker must not produce multiple events.
3. **`protocol.ts`** — round-trip serialization and exhaustiveness of the union.

ICE negotiation cannot be meaningfully unit-tested. It gets a documented manual
two-browser check against the deployed URL, covering: cold connect, camera-denied join,
mid-session network drop, and relay-forced connect.

Runner: Vitest.

---

## 12. Deployment

- **Vercel** — Next.js app. HTTPS is required for `getUserMedia`; Vercel provides it.
- **Neon** — Lakebase Postgres for both history and the signalling table. Region chosen
  between the two participants rather than next to either.
- **Cloudflare Calls** — TURN, anycast, region-agnostic.

Env vars, all server-only — nothing in this app is `NEXT_PUBLIC_`: `DATABASE_URL`,
`CLOUDFLARE_TURN_KEY_ID`, `CLOUDFLARE_TURN_API_TOKEN`.

Cross-machine testing requires the deployed URL; `localhost` is a secure context for
single-machine dev only.

---

## 13. Roadmap beyond v1

| Cycle | Contents | New infrastructure |
|---|---|---|
| v2 | Card game — original deck, synced index | None |
| v3 | Photo booth — scheduled capture, full-res JPEG exchange over DataChannel | None |
| v4 | Movie sync — local-file playback, scheduled transport controls | None |
| v5 | Karaoke — LRCLIB lyrics, synced highlighting | Audio source undecided |

Every one of these is small **because** v1 builds `SyncedClock` and `protocol.ts`
properly. That is the point of the v1 scope.

### 13.1 Known open question

v5's instrumental audio source is undecided and has licensing implications. It does not
block v1–v4 and will be brainstormed separately before v5.
