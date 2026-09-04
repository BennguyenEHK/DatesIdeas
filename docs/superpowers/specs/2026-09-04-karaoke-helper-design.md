# Paste a link, both sides sing

**Date:** 2026-09-04
**Status:** approved for implementation

## The problem

Karaoke today has two paths and both cost someone a chore.

The YouTube path embeds a video. It is instant and it needs no files, but
`YouTubePlayer.setRate` returns `false` — YouTube rounds unsupported rates
towards 1, so the smooth drift correction in `sync.ts` (`RAMP_RATE`,
`MAX_RAMP_SEC`) has never once run on it. Every correction is a visible jump.

The own-track path fixes that — `AudioPlayer.setRate` genuinely works — but it
asks both people to find the same MP3 and the same `.lrc`, separately, before
the room can sync them. Nothing transfers; only the position does.

What we want is the first path's convenience with the second path's sync:
**either person pastes a YouTube link, and both screens load that karaoke with
audio and scrolling lyrics, with no files, no installs mid-date, and no extra
step for the other person.**

## Why this cannot be done on Vercel

Four independent blockers, established by measurement and by checking the
state of each dependency:

1. **`play-dl` is archived** (7 June 2025, read-only). YouTube rotates its
   player cipher every few weeks; an unmaintained extractor stops working and
   stays stopped.
2. **`fluent-ffmpeg` is archived** (22 May 2025) and is only a wrapper — it
   spawns an `ffmpeg` binary that Vercel's runtime does not have.
3. **The 250 MB function limit.** `ffmpeg-static` is ~80 MB. Solvable, but see 4.
4. **YouTube blocks datacenter IPs.** AWS, GCP and Azure ranges get
   *"Sign in to confirm you're not a bot"* almost immediately. Vercel runs on
   AWS. The same command succeeds on a home connection and fails on a server
   purely on IP reputation. Cookie exports and client spoofing expire and need
   re-patching every few weeks.

Blocker 4 is decisive and no npm package fixes it. Railway does not fix it
either: Railway runs on GCP, AWS and Railway Metal, all datacenter ranges. It
solves 1, 2 and 3 and leaves the one that matters.

**The only reliable fix is a residential IP.** M has one.

## The design

A small helper service on M's PC does the fetching. It is a service the *room*
uses, not a thing each person runs — so **K installs nothing**.

### When M pastes

```
M pastes URL
  └─► helper (M's PC, residential IP)
        ├─ yt-dlp  → bestaudio[ext=m4a] + metadata
        └─ LRCLIB  → .lrc
  ◄─── { audio bytes, lrc, title, durationSec }
  ├─► M decodes → plays
  └─► file channel ──► K decodes → plays
```

### When K pastes

```
K pastes URL
  └─► sync channel ──► M's browser  { t: "track-request", url }
        └─► helper (M's PC)
              ├─ yt-dlp  → m4a + metadata
              └─ LRCLIB  → .lrc
        ◄─── { audio bytes, lrc, title, durationSec }
        ├─► M decodes → plays
        └─► file channel ──► K decodes → plays
```

Identical from K's side: she pastes a link, the karaoke appears. She never
learns the helper exists.

Routing K's request through M's browser also means **the helper's shared secret
never leaves M's machine**. K's browser only ever says "please fetch this", over
a connection that is already peer-authenticated.

### Why one helper and not two

A second helper on K's residential IP in Surabaya would remove M's PC as a
single point of failure, and roughly doubles the work: a second secret, a second
tunnel, URL discovery for both, and a rule for which helper serves which
request. M is present by definition during a date, so the failure mode is
"M's PC is off", which also means there is no date. Deferred, not rejected.

## Decisions

### No ffmpeg

`yt-dlp -f bestaudio[ext=m4a]` yields AAC in an MP4 container. Current Chrome,
Firefox, Safari and Edge all decode that through `decodeAudioData`. Dropping
the transcode removes an 80 MB binary, an archived wrapper library, and several
seconds per song.

`decode.ts` already accepts whatever `decodeAudioData` accepts, so no change is
needed there.

### Cloudflare Tunnel, not ngrok

ngrok's free tier was cut in February 2026 to 1 GB/month, **two-hour sessions**,
and an interstitial warning page that breaks programmatic `fetch` unless a
header is set. A two-hour cap ends mid-date.

Cloudflare Tunnel is free with no bandwidth cap and no session timeout. A
`trycloudflare.com` quick tunnel needs no domain. Its URL rotates on restart,
which is fine because the helper registers its current URL on startup (below).

### URL discovery through Neon

On startup the helper PUTs its tunnel URL to `/api/helper`, which upserts a
single row. M's browser GETs it before the first request. No hardcoded
hostname, and a rotated quick-tunnel URL heals itself on the next restart.

The registration endpoint is authenticated with the same shared secret. Without
that, anyone could point the room at a machine they control.

### A second data channel for bytes

The existing `sync` channel is JSON only — `usePeerConnection.ts:172` sends
`encode(m)` and `:189` discards anything non-string. Two options existed:
base64 chunks inside the JSON protocol, or a second binary channel.

**A second channel is required, not merely tidier.** The `sync` channel carries
`media` position messages, and playback sync depends on them arriving promptly.
Pushing ~5 MB of base64 through it would head-of-line block those messages for
the whole transfer and break sync exactly when a song is starting.

So: control messages stay on `sync`; bytes move on a new `files` channel with
`binaryType = "arraybuffer"`. Binary also avoids base64's 33% overhead.

### What is not changing

`decodeTrack`, `AudioPlayer`, `audioClock`, `useSyncedPlayback`, `parseLrc` and
`LyricsRoll` are untouched. Both sides still decode to an in-memory
`AudioBuffer` and play from it, so playback has zero network jitter and
`positionAt()` stays pure arithmetic. This is why the design transfers a file
rather than streaming a URL: a streamed track would reintroduce buffering
stalls into the one component currently immune to them.

## Components

| Unit | Path | Purpose |
|---|---|---|
| 1 | `src/lib/rtc/protocol.ts` | Four new control messages + decode guards |
| 2 | `src/lib/rtc/fileChannel.ts` | Pure chunk/reassemble, progress, integrity |
| 3 | `src/lib/karaoke/lrclib.ts` | Build query, parse response, pick by duration |
| 4 | `src/lib/karaoke/helperClient.ts` | Browser→helper fetch, injectable `fetch` |
| 5 | `src/app/api/helper/route.ts` + `neon/migrations/0006_helper.sql` | URL registry |
| 6 | `helper/` | Standalone Node service: yt-dlp, LRCLIB, secret, registration |
| 7 | `RoomClient.tsx`, `KaraokePanel.tsx` | Wiring, progress and error states |

### 1. Protocol

```ts
| { t: "track-request"; url: string; requestId: string }
| { t: "track-meta"; requestId: string; title: string; durationSec: number;
    bytes: number; chunks: number; lrc: string | null }
| { t: "track-done"; requestId: string }
| { t: "track-error"; requestId: string; message: string }
```

`requestId` exists so a slow first request cannot be mistaken for the reply to
a second one. `lrc` rides in `track-meta` because it is a few kilobytes of
text, far below any reason to chunk it.

Decode guards follow the existing shape: validate every field, return `null`
rather than throw, and let an unknown `t` fall through to `default`.

### 2. File channel

Pure functions over `ArrayBuffer`, no WebRTC types, so they test under jsdom:

```ts
export const CHUNK_BYTES = 16 * 1024;   // safe SCTP message size
export function chunkTrack(bytes: ArrayBuffer): ArrayBuffer[]
export function createAssembler(expectedChunks: number, expectedBytes: number): Assembler
```

The assembler takes chunks in order, reports `received / expected` for a
progress bar, rejects an overrun, and returns a single `ArrayBuffer` only when
the count and the byte total both match. A short final chunk is normal and must
not be treated as an error.

The sender must watch `bufferedAmount` and pause above a high-water mark,
resuming on `bufferedamountlow`. Without that, 300 chunks queued at once can
blow up memory or drop the channel.

### 3. LRCLIB

`https://lrclib.net/api/search?track_name=&artist_name=` — no key, no auth.

Pure module: build the query, parse the JSON, and **choose by duration**. The
match matters: several recordings share a title, and the one whose duration is
closest to the track we actually fetched is the one whose timestamps will line
up. Reject anything more than ~3 s away rather than show lyrics that drift.

Prefer `syncedLyrics`; ignore `plainLyrics`, which has no timestamps and would
render as a static block in `LyricsRoll`.

Returning `null` is a normal outcome, not an error — the song still plays.

### 4. Helper client

```ts
export async function fetchTrack(
  helperUrl: string, secret: string, youtubeUrl: string,
  deps?: { fetch?: typeof fetch },
): Promise<TrackResult | TrackFailure>
```

Failures are named, not numeric, in the shape `decode.ts` already uses:
`"helper-unreachable" | "not-found" | "extract-failed" | "unauthorized" | "bad-url"`.
`useKaraokeTrack`'s `DECODE_MESSAGE` map is the precedent for turning those into
sentences.

### 5. Registry route and migration

```sql
create table if not exists helper_endpoint (
  id         int primary key default 1 check (id = 1),
  url        text not null,
  updated_at timestamptz not null default now()
);
```

Single row by construction. `GET /api/helper` returns the URL; `PUT` upserts it
and requires `Authorization: Bearer <HELPER_SECRET>`.

`HELPER_SECRET` is **server-only**. It must never carry a `NEXT_PUBLIC_` prefix
— that would compile it into browser JavaScript and hand anyone the ability to
drive M's machine. It is read through `serverEnv()` alongside `databaseUrl`.

The browser never sees the secret: `GET` returns only the URL, and the browser's
`POST` to the helper is authorised by a short-lived token minted by the route.

### 6. The helper

A standalone Node service in `helper/`, not part of the Next build.

```
POST /extract   { url }        → { title, durationSec, lrc, audio: <binary> }
GET  /health                   → { ok: true, version }
```

- Rejects any request without the shared secret, before parsing anything else.
- Validates that `url` is a YouTube URL. It must never be a general-purpose
  fetcher on the public internet.
- Spawns `yt-dlp` with an explicit argument array — never a shell string, or a
  crafted URL becomes command injection on M's machine.
- Caps duration (~12 min) and size (~30 MB) so one bad link cannot fill the disk.
- Writes to a temp dir and deletes on both success and failure.
- Registers its tunnel URL on startup and re-registers periodically.

### 7. UI

The paste bar in `KaraokePanel` keeps its two tabs. The YouTube tab stops
calling `onLoad` with a video id and instead requests a track. States to show:
looking up, downloading, transferring (with `received / expected`), ready, and
each named failure.

`RoomClient` gains a `track-request` handler that runs only on the side that
has the helper, and a `files` channel receiver that feeds `createAssembler`.
`trackMode` is already the flag that switches `useSyncedPlayback` from the
YouTube player to `AudioPlayer`; it stays.

## Testing

Every unit above except 6 and 7 is pure and gets vitest coverage in the repo's
existing style. Specifically:

- **Protocol:** every new message round-trips; every field rejected when wrong;
  an unknown `t` returns `null`; an old peer's message still decodes.
- **File channel:** exact multiple of `CHUNK_BYTES` and a short final chunk both
  reassemble byte-identically; a missing chunk never completes; an overrun is
  rejected; progress is monotonic.
- **LRCLIB:** closest duration wins; a >3 s gap is rejected; `syncedLyrics`
  preferred; empty results return `null` not an error.
- **Helper client:** each named failure produced from the matching condition;
  `fetch` injected, never real network.

The helper gets its own tests for argument construction (proving no shell
string is ever built) and for secret rejection.

## What M must do by hand

1. Install `yt-dlp` and Node on the PC.
2. `npm install && npm run install-service` in `helper/`.
3. Install `cloudflared`, run a quick tunnel as a service.
4. Put `HELPER_SECRET` in `.env.local` and in Vercel (no `NEXT_PUBLIC_` prefix).
5. Run `npm run db:migrate`.

Precise commands are delivered with the implementation.

## Known costs

- **~20–45 s between pasting and singing** (fetch, then ~5 MB across the data
  channel). The YouTube embed was instant. A progress indicator is required, not
  optional — a frozen screen for 30 s reads as broken.
- **M's PC is a single point of failure.** If it is off or asleep, neither
  person can load a song. Auto-start reduces this; it does not remove it.
- **One-time setup on M's side only.**
- **The shape has changed:** M's machine now fetches audio on K's behalf and
  sends it to her, rather than only for M. Raised, weighed, and decided by the
  user; recorded here so it is not rediscovered later.

## Out of scope

- A second helper on K's side.
- Any bucket storage of audio. Nothing is stored on a server; bytes go from M's
  machine to K's browser and live in memory until the room closes.
- Video. Audio plus `LyricsRoll` replaces the karaoke video's picture at 1/12th
  the bytes and without reintroducing streaming stalls into sync.
