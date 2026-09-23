# The music bar — design

## What it is

A slim strip under the top bar, above the two faces, in the plain call and in
the card game. Both people hear the same YouTube music together and both can
add to tonight's queue by pasting a link. It is absent in karaoke and movie,
which own the shared player; opening either stops the music. Moving between
the plain call and the card game keeps the music going.

## How the sound stays together

Reuses the room's existing machinery: `useSyncedPlayback` with the shared
`media` message, `YouTubePlayer`, and the room's `SyncedClock`. Each device
plays its own copy; nothing streams through the call. Precision is
`"watching"`, the film's tolerance, not the singer's.

- Play, pause, previous, next, and skip ±10 s are shared.
- Volume is personal: a `Volume` slider, remembered on this device
  (`datesidea.music-volume`, default 60).
- `useSyncedPlayback` gains `seek(seconds)`: broadcasts the new position
  with the current playing flag, like `load` does. Position is clamped to
  `[0, duration]` when the duration is known.
- `YouTubePlayer` gains `onEnded`, fired once per video on `ENDED`.

## The queue, for tonight only

`src/lib/music/queue.ts` is a pure module over the wire type in
`protocol.ts` (`MusicTrack`, `{ t: "music"; queue; index; revision; sentAt }`):

```ts
interface MusicState { queue: MusicTrack[]; index: number | null; revision: number }
addTracks(state, tracks, now): MusicState        // appends; starts index at 0 if null
removeAt(state, at): MusicState                  // shifts index; null if queue empties
jumpTo(state, at): MusicState
next(state) / previous(state): MusicState        // clamp at the ends, no wrap
acceptRemote(local, incoming): MusicState        // higher revision wins; tie → later sentAt; tie → keep local
```

Every local change bumps `revision` and broadcasts whole state. The hook
`useMusicQueue({ send, identity, now })` holds the state, exposes those
operations bound to `send`, an `accept(message)` for the room's message
router, and `resync()` for `hello` (re-sends state if the queue is non-empty).
Song ends: the device whose `YouTubePlayer` fires `onEnded` calls `next()`;
if both fire, the second `next` is a no-op because the index already moved
(idempotent by index, checked before bumping the revision).

The queue dies with the room. Nothing is stored.

## Adding songs

`src/lib/music/links.ts`:

```ts
parseYouTubeLink(raw): { kind: "video"; videoId } | { kind: "playlist"; listId } | null
```

Accepts `youtu.be/<id>`, `youtube.com/watch?v=<id>`, `/shorts/<id>`,
`music.youtube.com/watch?v=`, and any of those with `list=<id>`, where the
playlist wins when `list=` is present and the path is `/playlist`. Playlist
ids are `PL…`, `OLAK…`, `RD…`, `UU…`, `LL`, up to 64 chars of `[A-Za-z0-9_-]`.

Playlist expansion needs no API key: the bar's own player runs
`cuePlaylist({ listType: "playlist", list })`, waits for `getPlaylist()` to
return ids (polled every 250 ms for up to 5 s), adds those ids to the queue,
then cues the first queued video again. `YouTubePlayer` exposes
`expandPlaylist(listId): Promise<string[]>` on its handle for this.

Titles come from `GET /api/oembed?videoId=<id>`, a server route that calls
`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=<id>&format=json`
and returns `{ title, author }` or 404. No key. Validated id only. Cached
for a day with `Cache-Control: public, max-age=86400`. The bar fills titles
in as they arrive; a track shows its id until then. Whoever added the song
looks the titles up and re-broadcasts the queue once with them filled.

## The bar

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ▣▣▣  Điều Anh Biết                  ⏮  ↺10  ▶  ↻10  ⏭     ♪ ───●────  ⌄ Up next 3 │
│ 64px Chi Dân · added by K          2:14 ───────────── 4:06                [ + link ] │
└──────────────────────────────────────────────────────────────────────────────┘
```

- The 64 px picture on the left is the `YouTubePlayer` itself, 16:9, with
  `pointer-events: none`. It is the artwork, and it is what makes playback
  legitimate on every device.
- The title is the one bold thing: `font-display` (Poiret), cream, one line,
  ellipsised. Under it, in `--mist`, small: author · added by {name}.
- A 2 px `--lamp` line along the bottom edge fills left to right as the song
  plays (position / duration, updated by `requestAnimationFrame` from the
  handle's `currentTime()`; no state per frame). It is the only accent.
- Controls, in order: previous, back 10 s, play/pause, forward 10 s, next.
  Icon buttons, `--cream` on hover, `aria-label`s: "Previous song",
  "Back 10 seconds", "Play music" / "Pause music", "Forward 10 seconds",
  "Next song".
- Volume: the existing `Volume` control, moved out of `MoviePanel.tsx` into
  `src/components/Volume.tsx` and imported by both.
- **Up next** toggles a list dropping from the bar's right edge: each track
  as a row with title, "added by {name}", and a remove mark (`aria-label`
  "Remove {title}"). The playing row is lit in `--lamp`. Clicking a row
  jumps to it.
- **+ link** toggles a single field, placeholder "Paste a YouTube link".
  Pasting adds immediately; Enter also adds. A **Paste** button appears
  when `navigator.clipboard.readText` exists and reads the clipboard on tap.
  A link that is not YouTube shows "That's not a YouTube link" under the
  field and keeps the text.
- Empty: only "Paste a YouTube link to play music for both of you" and the
  + link button. No player mounted until the first track.
- Phone (`@container` under 640 px): two rows, title and controls above,
  volume and Up next below. Nothing scrolls horizontally.
- Reduced motion: the progress line still fills; nothing else animates.

Styled with the room's tokens only (`--letterbox`, `--dusk`, `--lamp`,
`--cream`, `--mist`, `--edge`, `--neon` untouched). No new colours.

## In the room

- `MusicBar` renders under the top bar when `current === null || current === "cards"`.
- `applyActivity` currently clears the shared player whenever the new
  activity is not karaoke or movie. That would silence the music on every
  switch between the call and the cards. It changes to clear only when
  **leaving** karaoke or movie, or **entering** either of them.
- Entering karaoke or movie sets the music queue's `index` to null (queue
  kept, nothing playing); coming back shows the queue with nothing playing
  until someone presses play or a track.
- The `music` message routes to `useMusicQueue.accept`; `resync` runs on
  `hello` with the others.

## Testing

- `queue.ts`: every operation, including remove-before-index shifting,
  removing the playing track, next at the end, and `acceptRemote` on all
  three tie cases.
- `links.ts`: each accepted URL shape, playlist precedence, and rejections
  (other hosts, a `v=` that is not 11 chars, javascript:).
- `/api/oembed`: bad id → 400; upstream 404 → 404; success → title and
  author with the cache header; upstream failure → 502.
- `useSyncedPlayback.seek`: broadcasts and clamps.
- `YouTubePlayer`: `onEnded` fires once per `ENDED`.
- `MusicBar`: empty state; adding a video link appends and broadcasts;
  a non-YouTube link shows the message; controls call the right operations;
  Up next lists, lights the current row, removes, jumps; phone layout does
  not overflow (container query class present).
- `RoomClient`: the bar shows in the call and cards, not in karaoke or
  movie; switching call → cards does not clear the player.

## Later, not now

Registering links in the app's share target, so YouTube's own Share sheet
can send a song straight to the room.
