# Photo booth looks, CreateSpace workshops, memory sky and web games

Approved 2026-09-13. Four areas, built in the order booth → CreateSpace → album → web game.

## Photo booth

- A strip has 1, 2, 3 or 4 photographs (`SHOT_COUNTS` in `src/lib/photo/strip.ts`). A finished
  one-shot strip is shown over the whole 16:9 booth frame instead of in the side column, except
  while a new sitting is running.
- Three picture backgrounds join the six painted looks: `tokyo`, `paris`, `jungle`, appended to
  `THEME_IDS`. A theme's `backdrop` is an SVG under `public/booth/backdrops/`, drawn cover-cropped
  behind the cut-out people by the same `paintScene` the live stage and the strip use.
- Looks designed in CreateSpace appear after the built-in swatches, with a "+" to design one.
  Choosing one fixes the shot count to the look's own.
- The finished strip has a star-shaped, glowing **Edit** button that opens it in CreateSpace.

## Designed looks

- A look is two PNG layers the size of `stripLayout(shots)`: `backdrop` (paper, white photo
  windows, what sits behind people) and `overlay` (marks drawn over people), plus a caption ink.
  The booth paints backdrop → cut-out people clipped to each window → overlay → caption.
- Stored per pair, like the album: table `booth_looks` (migration 0010), objects under
  `looks/<pairId>/`, routes `/api/looks`, `/api/looks/[id]`, `/api/looks/sources` (background
  pictures uploaded while designing). Upload is presign → PUT → confirm with an HMAC receipt.
- Both screens in a call load the same look by id; the `photo` message carries `lookId`.

## CreateSpace

- Opens on a workshop menu: **Photo strip**, **Draw together** (the original draw-on-an-album-
  picture canvas) and "coming soon" tiles.
- Which workshop is open, and the strip's shots, paper, background placement and Merge state, are
  one `CreateSession` sent whole on the shared clock; the later stamp wins (`session.ts`).
- Marks stay operations. Strokes gain a tool (pencil, brush, spray, eraser) and any hex colour;
  spray dots are seeded by the stroke id so every screen draws the same dots. Marks live on their
  own layer, so the eraser removes marks only. Redo re-adds an undone mark under a new id, so an
  undo and its redo commute however they arrive.
- **Merge** shows both cameras live inside the photo windows; people are cut out live only when a
  background picture is set. It is a preview and is never saved.
- **Edit vs new**: `session.mode`. From the booth's Edit button it is `edit`: the strip on the table
  is each screen's own developed strip, and Save sends `canvas-finish`; each screen then draws the
  shared marks over its own strip (`composeOverStrip`) and hands it back to the booth, so no image
  crosses the connection. From the menu it is `new`, and Save stores a designed look.

## Album: memory sky

- "Play this day" and its synced film are retired (component, schedule, peer message).
- The projected memory becomes a night sky of floating paper lanterns: the selected memory is the
  large central lantern with its date and caption, up to three neighbours drift on each side.
  Movement is only by hand: arrows, arrow keys, swipe, or clicking a lantern. The reel stays below
  as the film-roll scrubber; in a call the selection is shared as before.

## Web games

- GameWord gets a **Web Game** entry listing free two-player browser games
  (`src/lib/gameword/webGames.ts`). Sites checked on 2026-09-13 to allow framing play inside the
  app; the rest (Gartic Phone, Lichess) open in a new tab. The open game is shared through a
  `webgame` message, later `sentAt` wins.

## Build

- Spine (Claude): shot counts, `looks/types.ts`, `createspace/session.ts`, `webGames.ts`, the new
  peer messages, then RoomClient wiring and the film removal.
- Codex workers: booth; looks storage; drawing engine; CreateSpace interface; memory sky; web games;
  background artwork. Every worker's diff reviewed, rendered where visual, and re-run on failure.
- Validation: full unit suite, type check, lint, production build, migration 0010 applied before
  the push to `main`.
