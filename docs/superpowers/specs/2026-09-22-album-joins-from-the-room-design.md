# The album joins from the room — design

## Problem

The album belongs to a *pair*, and a device proves it belongs by holding the
pair's one season ticket in an HttpOnly cookie. The ticket exists in exactly
one place, so the only way onto a second device is carrying the `/us/<ticket>`
link there. Until then that device cannot open the album or the calendar, and
cannot upload photos or videos. The room hides both top-bar buttons from it.

Ben and K want K's device on the album from the moment she is in the room
with him, with no link and no asking.

## Behaviour

1. **Both buttons are always there.** The album and calendar marks appear on
   the top bar for every device in the room, paired or not.
2. **A device joins the album by itself.** When the two devices connect
   (`hello`), if one is on the album and the other is not, the paired device
   mints a one-time invitation, sends it over the data channel, and the other
   device redeems it for a key of its own. No tap on either side. Both
   directions work: whichever device is paired invites the other.
3. **While that happens**, an unpaired device that opens the album or calendar
   sees "Getting you in…" instead of "This device isn't on your album yet".
   If the join fails, it shows the reason in one line with a **Try again**
   button that sends a fresh request over the channel.
4. **After joining**, that device is a full member: it can look through the
   album, upload photos and videos, and use the calendar, in the call or on
   its own later. The key persists in its cookie like any season ticket.
5. **Nothing happens behind anyone's back.** When a new device joins, the
   inviting device shows one line, "A new device joined your album", with
   **Undo**. Undo revokes that device's key immediately; the other device
   drops back to unpaired and its next request will be invited again only if
   the pairing device connects to it afresh. The line stays for 30 seconds or
   until dismissed.
6. **"Forget other devices"** (rotate) still signs out every device, this one
   included, and hands back a fresh link. Per-device sign-out is out of scope.

The rule this creates is stated plainly: **whoever joins your room joins your
album.** A room code is six characters and lasts a day. Undo is the visible
brake on that; the rule itself is accepted.

## Data

### `pair_keys` — one album, several devices

```sql
create table pair_keys (
  id          text primary key,           -- random, for revocation
  pair_id     text not null references pairs(id) on delete cascade,
  key_hash    text not null unique,
  created_at  timestamptz not null default now(),
  last_seen_at timestamptz
);
create index pair_keys_by_pair on pair_keys (pair_id);
```

Migration `0011_pair_keys.sql` creates the table and copies every existing
`pairs.key_hash` into it, so every device that is paired today stays paired.
`pairs.key_hash` is kept for one release as a read-only fallback and dropped
later.

- `findPairByTicket` looks in `pair_keys` first, then `pairs.key_hash`.
  Touching `last_seen_at` is best effort.
- `createPair` writes the first key into `pair_keys` as well as `pairs`.
- `rotateTicket` deletes every row in `pair_keys` for the pair, inserts one
  new key, and updates `pairs.key_hash` to match. Meaning unchanged: every
  other device is signed out.
- `revokeKey(pairId, keyId)` deletes one row. Refuses to delete the last key.

### `pair_invites` — one-time, short-lived

```sql
create table pair_invites (
  code_hash   text primary key,
  pair_id     text not null references pairs(id) on delete cascade,
  expires_at  timestamptz not null,
  used_at     timestamptz
);
```

The code is 128 random bits, base64url, the same shape as a ticket, hashed
the same way. It is never typed by a person, so its length does not matter;
it travels only over the DTLS data channel. Valid for five minutes, once.

## Endpoints

| Route | Auth | Does |
|---|---|---|
| `POST /api/pair/invite` | paired | Mints an invite for the caller's pair. Returns `{ code, expiresAt }`. |
| `POST /api/pair/claim` `{ code }` | none | Finds an unexpired, unused invite; inserts a new `pair_keys` row for its pair; marks the invite used; sets the ticket cookie to the new key; returns `{ paired: true, keyId }`. Any failure is `401 { error: "unauthorized" }` with no further detail. |
| `POST /api/pair/revoke` `{ keyId }` | paired | Deletes that key if it belongs to the caller's pair and is not the caller's own key. |
| `GET /api/pair` | — | Unchanged: `{ paired }`. |

Claim also carries the `keyId` back so the inviting side can undo it. The
claiming device tells the inviter `{ t: "album-joined", keyId }` over the
channel; nothing about keys is otherwise exposed to the browser.

## Messages on the data channel

```
{ t: "album-join-request" }                       unpaired → paired
{ t: "album-join", code: string, expiresAt: number }   paired → unpaired
{ t: "album-joined", keyId: string }              unpaired → paired, after claim
```

All three decode strictly (`protocol.ts`), and an old build that does not
know them ignores them, as with every other message.

## Flow in the room

`usePair()` already answers `{ paired, known }` per device. A new hook
`useAlbumJoin({ paired, known, send, peerConnected })`:

- On `hello` (peer connected) and whenever `known` becomes true: if this
  device is **not** paired, send `album-join-request`.
- On receiving `album-join-request` while **paired**: `POST /api/pair/invite`,
  send `album-join` with the result. One invite in flight at a time; a second
  request while one is pending is ignored.
- On receiving `album-join` while **not** paired: `POST /api/pair/claim`.
  On success: refetch `usePair()` (it becomes paired), reload the album and
  calendar if open, send `album-joined`.
- On receiving `album-joined`: show the "new device joined" line with Undo.
  Undo calls `POST /api/pair/revoke` and sends nothing further; the revoked
  device finds out the next time it asks the server.
- Exposes `{ joining: boolean, error: string | null, retry: () => void }` for
  the album and calendar's unpaired screens.

Both devices run the same code, so whichever is paired does the inviting.
If both are paired, nothing is sent. If neither is paired, the request is
sent and answered by nobody; the screens keep saying the album has not been
set up, and offer the existing `/us/new` link.

## Top bar

The `paired ?` guard around the album and calendar marks goes. Their
`aria-label`s are unchanged.

## Testing

- `pair/store`: key lookup through `pair_keys` and the fallback; rotate
  deletes and reinserts; revoke refuses the last key.
- `/api/pair/invite`: 401 unpaired; returns a code with a five-minute expiry.
- `/api/pair/claim`: expired, used, unknown and malformed codes are all 401
  with the same body; a good code sets the cookie and marks the invite used;
  a second claim of the same code is 401.
- `/api/pair/revoke`: refuses another pair's key and the caller's own key.
- `protocol`: encode/decode of the three messages, and rejection of a
  malformed `album-join`.
- `useAlbumJoin`: request on hello only when unpaired; invite on request only
  when paired; one invite in flight; claim then refetch; retry sends a fresh
  request; Undo revokes.
- `RoomAlbum` / `RoomCalendar`: "Getting you in…" while joining, "Try again"
  on error, and the not-set-up message when nobody can invite.
- `RoomClient`: album and calendar marks render for an unpaired device.

A live test by both of them remains: K reloads in a room with Ben, opens the
album from her own top bar, and uploads a photo.
