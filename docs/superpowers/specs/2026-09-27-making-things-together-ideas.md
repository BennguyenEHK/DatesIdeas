# Making things together — ideas for later

Written 2026-09-27, when the Lookbook was chosen as the first of these. The
rest are kept here so the next one starts from the reasoning, not from
scratch. None of this is designed yet; each needs its own design pass.

## Why this exists

K is a model and a tailor/retailer, with no programming or UI background, and
Ben wants her to shape the app too — through simple interactions, not code.
Agreed order: **B first** (more things to make together, built around her
eye for style), **then A** (K shaping the app itself). Making things
together should not live only in CreateSpace: what you make is worth more
when the rest of the app uses it.

The pattern already exists and works: a look designed in CreateSpace becomes
a frame in the photo booth (`src/lib/looks`). Every idea below follows it —
made together in one place, used somewhere else.

## B — things to make together

### Lookbook: "Dress each other" — chosen first
Shared outfit board; photograph or add clothes, arrange outfits, heart or
suggest swaps; pin an outfit to a calendar day; keep outfits in the album.
Has its own design doc.

### K directs the booth
K as creative director in the photo booth: she picks pose cards ("chin down,
look over your shoulder"), the backdrop and the timing, and Ben follows her
directions shot by shot.
- Fits: her modelling work — she already knows how to direct a shoot.
- Leads to A: her pose sets and shoot plans are saved and reusable ("K's
  Paris shoot").
- Builds on: the photo booth (`PhotoBoothPanel`, `useBooth`, backdrops,
  themes), CustomLook.

### Atelier: "Design a piece for each other"
A body outline (croquis) to sketch a garment on, using the Doodle Workshop's
drawing tools, plus fabric swatches taken by photographing real fabric, a
pattern or a flower.
- Fits: tailoring — she could design a real piece for Ben.
- Leads to A: her swatches become patterns and stickers used across the app
  (strips, doodles, chat).
- Builds on: `useDrawingTools`, `MarksLayer`, the workshop tray, camera
  capture.

## A — K shapes the app itself

### "Styled by K" room theme
K picks colours, lettering and a sticker set; the room takes that look on
both screens. Constrained choices (palettes and fonts that already work
together), so anything she picks looks good.

### Idea wall
K marks up a screenshot of the app ("make this pink, put this here"); it
lands with Ben — and with Claude — as a request to build. The lowest-effort
way for her to design the app without any tools.

## Open questions for when these come up
- Which of these need a season ticket (pair storage), and which can live for
  one evening only.
- Whether K's creations are marked as hers (a "by K" credit) — likely yes;
  it is the point of A.
