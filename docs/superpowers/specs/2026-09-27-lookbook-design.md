# Lookbook — design

Draft 2026-09-27, awaiting approval. The first of the "making things
together" ideas (see `2026-09-27-making-things-together-ideas.md`): built
around K's eye as a model and tailor, with nothing to learn beyond tapping,
dragging and taking a photo.

## What it is

A shared wardrobe and outfit board. Either of you adds pieces of clothing —
photographed with the camera or picked from files — and arranges them into
outfits on a board, both screens moving together. An outfit can be hearted,
given a day to wear it, and kept in the album as a picture.

It is its own activity, **Lookbook** (👗), not a CreateSpace workshop:
it keeps what you make across evenings, so like the album and the calendar
it needs a season ticket, and CreateSpace's session and marks are built for
drawing. Without a ticket it shows the same join prompt the album shows.

## Pieces (the wardrobe)

- Added by camera (`openCamera("environment")` + `takePhoto`, JPEG, longest
  edge 1600px) or from a file, which is shrunk the same way before upload.
- Each piece has a **kind** — top, bottom, dress, outerwear, shoes, bag,
  accessory, other — picked with one tap, and an optional short label
  ("black silk slip").
- `added_by` records who added it, shown as "yours" / "theirs", so K's
  pieces are credited to her.
- Up to 200 pieces per pair; photos jpeg/png/webp, up to 12 MB before shrink.
- Stored like designed looks: presigned PUT to object storage under
  `lookbook/<pairId>/<token>.<ext>`, confirmed with an HMAC receipt, then a
  row. A deleted piece is removed from every outfit that used it.

## Outfits (the board)

- An outfit is a name, an optional **wear on** date, an optional note, who
  made it, who hearted it, and a **layout**: each placed piece with its
  position, size and stacking order on a 3:4 board.
- Pieces are dragged from the wardrobe onto the board, then moved, resized
  and removed. Swapping is just that — either of you drags a different piece
  in; there is no separate "suggest" step.
- Up to 100 outfits per pair; up to 20 pieces on one board.

## Both screens together

- **Live arranging**: a new peer message carries one placement at a time,
  `{ t: "lookbook-place", outfitId, place: { pieceId, x, y, scale, z } | null, at }`
  (`null` removes). Applied last-writer-wins per piece by `(at, sender)`, the
  same rule CreateSpace's marks use, so both boards settle on the same layout.
- **Saving**: the side that made the last change saves the whole layout,
  debounced by one second. Both sides converge on one layout, so both saving
  it is harmless.
- **Everything else** (a piece added or deleted, an outfit created, renamed,
  dated, hearted or deleted) goes to the database and sends
  `{ t: "lookbook-changed" }`, and the other screen reloads — the pattern the
  album and the calendar already use.
- Whose board is open is shared too: `{ t: "lookbook-open", outfitId | null, at }`,
  so opening an outfit opens it on both screens.

## Leaving the Lookbook

- **Calendar**: an outfit with a *wear on* date shows as a small 👗 chip on
  that day in Our calendar, labelled with the outfit's name. Read-only there;
  the date is set in the Lookbook.
- **Album**: "Keep in album" draws the board to a PNG on a canvas and adds it
  with the existing `addToAlbum` as a `photo`. Piece images are drawn the way
  CreateSpace draws uploaded backgrounds, so the canvas is not tainted.

## Screens

One takeover: the wardrobe (pieces grouped by kind, with "+ Add piece") and
the outfits (cards with the board thumbnail, hearts and date) beside the
open board. On a phone they stack: board first, wardrobe as a strip beneath.
Large touch targets, no text entry needed to make an outfit (a name is
suggested: "Outfit 3"). Styled with the app's existing tokens.

## Data

Migration `neon/migrations/0012_lookbook.sql`:

- `lookbook_pieces (id text pk, pair_id uuid → pairs on delete cascade,
  object_key, content_type, bytes, kind, label, added_by, created_at)`
- `lookbook_outfits (id text pk, pair_id uuid → pairs on delete cascade,
  name, wear_on date null, note, created_by, loved_by text[], layout jsonb,
  created_at, updated_at)`

API, all behind `pairFromRequest` (401 without a ticket):

- `/api/lookbook/pieces` — `GET` list (signed URLs), `POST` presign +
  receipt, `PUT` confirm; `/api/lookbook/pieces/[id]` — `PATCH` kind/label,
  `DELETE`.
- `/api/lookbook/outfits` — `GET` (optionally `from`/`to` for the calendar),
  `POST` create; `/api/lookbook/outfits/[id]` — `PATCH` name/wearOn/note/
  layout/love, `DELETE`.

## Build

- Spine by Claude: migration, shared types and validators
  (`src/lib/lookbook/types.ts`), protocol messages, storage key allow-list,
  the activity registry entry (appended — `ACTIVITY_IDS` order is part of the
  wire format), the client and hook interfaces.
- Three Codex workers in parallel on disjoint files: server (store + routes
  + tests), client (API client, `useLookbook`, pure layout ops + tests), UI
  (components + tests, following the frontend-design and lock-in skills).
- Claude integrates: RoomClient wiring, the calendar chip, the album export,
  review of every diff, the full suite, then deploy.
- Tests at each layer: validators and layout ops (last-writer-wins,
  removal, caps), routes (auth, caps, receipts, pair isolation), hook
  (reload on `lookbook-changed`, debounced save), UI (add piece, place,
  move, heart, date, keep in album).

## Not in this version

Background removal from clothing photos, outfit comments, sharing outside
the pair, and the other ideas in the ideas doc.
