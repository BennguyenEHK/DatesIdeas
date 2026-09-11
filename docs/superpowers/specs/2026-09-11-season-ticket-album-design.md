# The season ticket, and the album it opens

A design for durable couple identity and the memory album built on it.
Sub-project 0+1 of six. Everything else planned — the call recorder, the
calendar, CreateSpace, GameWord, and the Android widget — waits on this one.

## Why this exists

FestiBooth is deliberately amnesiac. A room code dies after a day
(`neon/migrations/0004_room_expiry.sql`), keepsakes cascade away with the room
that made them, and `src/lib/history/identity.ts` says in as many words that
the device UUID *is not an account*. The README brags about it, correctly: a
six-character code in a text message is the whole authorization story.

That was right for an app about one evening. It is wrong for an app about a
year of them. An album that empties every second day is not an album, and a
reminder for next Friday has nobody to reach.

So this introduces exactly one durable thing — a pair — and hangs the album off
it. Rooms stay disposable. Nothing about the evening changes.

## What the promise becomes

Still no sign-up, no password, no email, no user table. What replaces them is a
**season ticket**: a 128-bit secret you open once on each device.

    festibooth.app/us/<secret>

The route sets an HttpOnly cookie and redirects to `/album`. The secret then
never appears in a URL again, and that is the point — URLs leak into browser
history, `Referer` headers, and the link previews chat apps generate on your
behalf. This one opens the whole album, forever.

The server stores `sha256(secret)` and never the secret, the same way it never
stores a photograph's bytes.

Three consequences are part of the design rather than later additions:

- **Pairing another device** shows the ticket as a QR, reusing `qrDataUrl`
  unchanged. It sits behind a deliberate tap and is never on screen by default:
  an app with a record button must not leave its own master key in the
  background of a recording.
- **Rotating the ticket** mints a new secret and overwrites `key_hash` **on the
  existing `pairs` row**. It does not create a second pair — doing so would
  leave the entire album attached to an identity nobody can open any more. An
  app with no passwords still needs a remedy for a link that ended up somewhere
  it should not have, and this is the only one available. Every other device
  must then be re-paired from the new QR, which is the cost of revocation and
  should be said plainly on the rotation screen.
- **Album items never expire.** A deliberate break from the 24-hour rule.
  `findKeepsake` joins `couples` precisely so an expired room cannot serve its
  files; the album's reads must not copy that join, and the migration says so
  out loud, because the next person to read this code will otherwise assume the
  expiry rule is universal.

## Two clients, one ticket

The browser is not the only client. A small native Android app — its own
sub-project, specified separately — will own the home screen widget, and Kotlin
cannot use an HttpOnly cookie.

So every route under `/api/album` and `/api/pair` authenticates from **either**
the cookie **or** an `Authorization: Bearer <ticket>` header, resolved by one
function both paths call. The Android app pairs by scanning the same season
ticket QR and keeps the secret in EncryptedSharedPreferences.

This is settled now rather than retrofitted because it is the shape of every
route handler, and because a second client discovered late is the usual reason
an API grows a second, worse half.

## The data

```sql
-- 0007_season_ticket.sql

create table pairs (
  id         uuid primary key default gen_random_uuid(),
  key_hash   text not null unique,
  created_at timestamptz not null default now()
);

alter table couples add column pair_id uuid references pairs(id) on delete set null;

create table album_items (
  id           text primary key,
  pair_id      uuid not null references pairs(id) on delete cascade,
  object_key   text not null,
  poster_key   text,
  kind         text not null check (kind in
                 ('strip','clip','photo','video','recording')),
  content_type text not null,
  bytes        bigint not null,
  happened_at  timestamptz not null,
  caption      text,
  loved        boolean not null default false,
  source_room  text,
  created_at   timestamptz not null default now()
);

-- The reel's own order: when things happened.
create index album_items_by_time on album_items (pair_id, happened_at desc);
-- The widget's order: when things arrived. See "Modules" for why these differ.
create index album_items_by_arrival on album_items (pair_id, created_at);

create table occasions (
  id         text primary key,
  pair_id    uuid not null references pairs(id) on delete cascade,
  title      text not null,
  on_date    date not null,
  yearly     boolean not null default false,
  cover_item text references album_items(id) on delete set null
);
```

`pair_id` on `couples` is nullable: a room started before pairing still works,
it simply cannot save to an album it does not belong to.

`happened_at` is the only field doing subtle work. A photo taken on Saturday and
uploaded on Tuesday belongs to Saturday — otherwise the timeline records when
you had signal rather than when you had a life. It is read from the file's own
`lastModified` and remains editable.

`poster_key` is a still for anything that moves, so scrubbing a year of memories
never downloads a single video.

`occasions.cover_item` is the picture the occasion's sign shows when the reel is
in months gear and the day itself is too small to read. Null means the sign
shows its title alone, which is also what a future anniversary with no photos
yet must do.

An occasion is a title pinned to a date, and membership is the whole of
`happened_at::date = occasions.on_date`. Nothing is ever filed, nothing is ever
in two places, and naming an occasion months later retroactively gathers that
day. `yearly` makes it recur; 29 February is the case that breaks naive
anniversary code and therefore the case the tests lead with.

## Storage

Uploads reuse what exists: `presignKeepsake` signs, the browser PUTs straight to
the bucket, the bytes never pass through Vercel — whose 4.5MB request-body limit
`src/app/api/keepsake/route.ts` already documents. Three changes:

- A sibling to `isKeepsakeKey` for `album/<pair-id>/<kind>-<token>.<ext>`. The
  server builds the key and never accepts one, or the signer becomes bucket-wide
  write access.
- **Posters are made in the browser** — seek a `<video>` to one second, draw to
  a canvas, upload the JPEG alongside. No server-side image processing, no new
  dependency, and the same approach `src/lib/photo/liveStrip.ts` already takes.
- **Download links are signed for ten minutes**, not the 24 hours
  `DOWNLOAD_URL_TTL_SEC` uses. That constant is tied to a room's life. The album
  page is `force-dynamic` and re-signs on every visit, so a longer TTL would
  only widen the window on a link that leaked.

Caps: 25MB a photo, 200MB a video. Enforced in the browser as a courtesy to the
person waiting, and on the server as the actual rule — a signed URL is a
capability, and whatever it permits is what lands in the bucket.

### Write order, corrected

`api/keepsake/route.ts` inserts its row *before* the browser uploads. If the PUT
then fails, a row points at a file that does not exist — the outcome
`0005_keepsakes.sql` itself names as the bad one: *a row pointing at a file
nobody can reach is worse than no row at all.*

The album inverts it: **presign, upload, confirm, insert.** A failed upload then
leaves an orphaned object in the bucket, which is invisible and costs fractions
of a cent, instead of a broken frame in the timeline. Same number of round
trips.

## The album page

At `/album`, in the same CinemaScope frame as the room: one memory projected in
the picture, and every control in the letterbox bars, because there is nowhere
on the picture for a control to live.

The bottom bar holds **the reel** — a continuous filmstrip of everything, in
time order, sprocket holes drawn as a repeating CSS gradient. Two speeds, like
an edit bench: swipe the picture to step one memory, drag the reel to travel.

### Zoom, not tabs

Day, month and occasion are not three views. They are three gears on one reel:

- **Frames** — every memory, one per frame.
- **Days** — one frame per day, that day's first picture, with a count.
- **Months** — one frame per month.

Zooming keeps the centred memory centred, so you never lose your place. Month
boundaries appear as leader tape: the marked, labelled film spliced between
reels, set in Poiret One because a month heading is identity and not data.

Three gears rather than tabs is the load-bearing interaction decision. Tabs
re-sort and lose your position; a gear does not.

### Two touches

**Loved memories glow.** `HoldHeart` already exists. Holding it blooms that
frame *on the reel* in `--lamp`, so scrubbing back through a year shows your
best days as visibly warmer spots along the strip. This is the one memorable
thing on the page, and everything else stays quiet so that it works.

**Occasions hang above the strip** — a small lit sign on a bracket at that date,
in the bulb vocabulary already used by `ActivityBar` and `QuestionCard`. A
yearly occasion with no photos yet shows its sign unlit, reusing the exact
dimmed treatment `bubbleClass` gives an activity that is not built. An unlit
bulb is an invitation.

### Motion

One orchestrated moment on load: the letterbox bars close in (`.bar-top`,
`.bar-bottom`, already written), then the reel threads — slides in from the
right and settles on today. Once. After that, motion only answers a hand.
`prefers-reduced-motion` gets the reel already threaded.

### An empty reel

Before anything is saved there is no picture to project, so the frame holds the
invitation instead: *Nothing on the reel yet.* Beneath it, the two ways in —
*Share a photo to FestiBooth from your phone*, and *Keep in the album* appearing
in the booth's save menu the next time you are in a room together. An empty
screen names the next action; it does not apologise for being empty.

### Not in v1

Search. Month zoom plus occasion signs reach anywhere in two gestures, and a
magnifying glass in the corner is the reflex rather than the answer. It arrives
when there are enough captions to search.

## Getting things in

**From a phone.** A web manifest and service worker make FestiBooth installable,
and a Web Share Target registration puts it in the Android share sheet. Share a
photo or video from the gallery and it lands dated by its own `lastModified`.
Both participants are on Android, where share-target is properly supported, so
no fallback path is required for them; the ordinary upload below covers any
other device.

The service worker is not spent effort. Web Push for the calendar needs the same
one.

**From the page.** A `+` on the reel bar: pick from the gallery or shoot on the
spot. Works on any device with no install.

**From a room.** `SaveMenu` offers three ways out today — download, QR photo, QR
video. When the room belongs to a pair, a fourth appears at the top, **Keep in
the album**, and it is the only one that needs no phone at all. That single
addition is what makes every existing activity feed the album.

## Modules

    src/lib/pair/
      ticket.ts       secret generation, sha-256, isTicket()      pure
      store.ts        findPairByHash, createPair, rotate          server-only, SqlTag
      session.ts      cookie and bearer, resolved to one pair     server-only
      usePair.ts      client hook
    src/lib/album/
      timeline.ts     items[] + gear -> frames                    pure
      occasions.ts    date matching, yearly expansion             pure
      keys.ts         album key construction and validation       pure
      poster.ts       video -> still JPEG on a canvas             browser
      items.ts        insert, list, love, caption, delete         server-only, SqlTag
      upload.ts       presign, PUT, confirm                       client
      useAlbum.ts     client hook
    src/components/   Reel, ReelFrame, Projector, OccasionSign,
                      AlbumEmpty, TicketQR
    src/app/us/[ticket]/route.ts     sets the cookie, redirects, renders nothing
    src/app/album/page.tsx
    src/app/api/pair/route.ts        create, rotate
    src/app/api/album/route.ts       list (with a `since` cursor), create
    src/app/api/album/[id]/route.ts  love, caption, delete

`timeline.ts` is pure, and that is the decision the testability of this feature
rests on. Given items and a gear it returns frames — no DOM, no clock, no
network. All three gears, the leader tape and the keep-the-centre-centred rule
are plain functions, exactly as `strip.ts`, `draw.ts` and `aggregate.ts` already
are. `Reel.tsx` then only draws what it is handed.

The `since` cursor on list exists for the Android widget, which asks "anything
new?" often and should never pull a whole album to find out.

The cursor runs on **`created_at`, not `happened_at`**, and the distinction is
not cosmetic. `happened_at` can be backdated — that is its entire purpose — so a
widget polling on it would silently never see a photograph shared on Tuesday
from Saturday's walk. Arrival order is the only order a cursor can trust. This
means `album_items` needs a second index on `(pair_id, created_at)`, which the
migration adds alongside the timeline one.

## When it fails

| Condition | Behaviour |
| --- | --- |
| No cookie or bearer at `/album` | The pairing screen, not a 404: *Open your season ticket on this device* |
| Ticket unknown, rotated away, or mistyped | One message for all three. Distinguishing them tells a stranger holding a guess which guess was closest — the reasoning `Gone()` in `src/app/k/[id]/page.tsx` already follows |
| Storage unconfigured | The album still lists and plays; only uploading says so, 503, in the wording `api/keepsake/route.ts` already uses |
| File over the cap | Said before the upload starts, naming the limit and the actual size |
| Upload fails | Retried once, then a plain failure with the file still selected. No row is written |
| Signed link expired mid-session | Re-signed on demand rather than an unexplained broken image |

## Testing

Pure and fully covered: gear grouping, month boundaries, occasion matching
including 29 February, album key validation, ticket generation and hashing, size
caps, and the presign/upload/confirm ordering.

No constant-time comparison is specified and none is needed. A ticket is looked
up by an indexed equality on its hash, which is not constant-time and cannot be
made so; the defence is that the secret is 128 bits of `crypto.getRandomValues`,
against which timing tells an attacker nothing they could finish using. Saying
this here is cheaper than a reviewer discovering the lookup later and assuming
it was an oversight.

Route handlers get fake-`SqlTag` tests in the manner of
`src/app/api/rooms/route.test.ts`, including the two that matter most — a
request with neither cookie nor bearer, and a bearer for a rotated ticket.

`Reel` gets a Testing Library test for scrubbing, for keyboard travel (arrows
step, shift-arrow travels, `+` and `-` change gear), and for every frame having
an accessible name of its date and kind.

Two things cannot be automated and belong in `docs/manual-qa.md`: the Android
share sheet on a real phone, and a real round trip to the bucket.

## Out of scope

Search, cropping and editing, CreateSpace drawing, the call recorder, the
calendar, sharing outside the pair, and any notion of more than two people.

## What this unblocks

| | Sub-project | Notes |
| --- | --- | --- |
| **0+1** | Season ticket and album | This spec |
| **1.5** | Android widget app | Kotlin and Jetpack Glance. The home screen widget, a tap-for-photo / hold-for-video capture button, and push. Sideloaded, no Play Store. Needs a `pair_devices` table and FCM. A widget cannot play video — a video note shows its poster frame and a play badge, and opens in the app |
| **2** | Call recorder | Record button, a review overlay on the recorder's screen only, a temporary gallery, QR download. Saves and favourites write here |
| **3** | Calendar | Time blocks, repeats, photographed timetables read by a vision model, Web Push on this spec's service worker |
| **4** | CreateSpace | Drawing and stickers over saved strips, together, over the room's existing message protocol |
| **5** | GameWord | In-browser two-player games, plus a launcher for a Minecraft server that necessarily lives on another host — the `helper/` tunnel pattern applies |
