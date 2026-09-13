# Day stacks and Play the day

Approved 2026-09-12. Direction chosen from four mockups: D (photo stacks) for browsing, C (a
little film of one day) for watching, both kept light enough to run beside a video call.

## D · Day stacks in the reel

- In the `days` and `months` gears, a frame holding more than one memory is drawn as a small
  stack of prints: the top photograph, the edges of up to two more behind it, and the count.
- Hovering the stack, or tapping it on a touch screen, fans it out above the reel: up to seven
  prints, or six and a "+N more" card. Clicking a print selects that memory.
- The `frames` gear is unchanged.
- Card positions come from `fanLayout` in `src/lib/album/fan.ts`, a pure tested function.
- In a call, the in-call album uses the same stacks; the shown memory is already synced.

## C · Play the day

- A "▶ Play this day" button under the projected memory, when that memory's day (in the
  viewer's time zone) holds at least two memories.
- It opens a full-screen film, `src/components/DayFilm.tsx`:
  - a title card: the long date, and an occasion's title when the day has one
  - each memory in time order for 3.5 s with a slow zoom and pan that varies per memory,
    crossfading into the next
  - a closing card with the first caption found that day, or the date again
- Moving memories show their poster with a ▶ badge and are not played inside the film.
- Controls: pause and resume, previous and next, a progress bar that seeks, close.
- Reduced motion: crossfades only, no zoom or pan.
- Timing is a pure schedule, `filmSchedule` / `segmentAt` in `src/lib/album/film.ts`. What is
  playing is a `FilmState` — the day, the instant elapsed time was zero, and the elapsed time
  it is frozen at when paused — so any screen can compute the same position from a clock.
- In a call the `FilmState` crosses as `{ t: "film", film, sentAt }` on the shared clock. The
  latest `sentAt` wins; a tie goes to the larger serialised state, so both screens settle on
  the same one. Starting anchors a short lead ahead so both screens begin together.

## Weight

- Upload makes a small JPEG still (longest edge 640 px) for photographs as well as videos,
  best effort, through the existing poster path. The reel and stacks already prefer
  `posterUrl`. Existing photographs keep loading the original. HEIC that a browser cannot
  decode uploads without a still.
- The film preloads only the next two memories.
- Nothing is rendered to a video file and nothing new is stored beyond the stills.

## Build

- Spine (Claude): `film.ts`, `fan.ts`, the `film` peer message, film state in `useTogether`,
  and the fixed `DayFilmProps` interface.
- Wave 1 (Codex, parallel): DayFilm and the ▶ button on the album page; reel stacks and fan
  out; photograph stills at upload.
- Wave 2 (Claude): the film and the stacks in the in-call album, synced.
- Validation: unit tests for every pure module and each component's behaviour, full suite,
  type check, lint, production build, then a live check after deploying.
