-- A couple that outlives the evening, and the album hung off it.
--
-- Everything in this app so far has been deliberately short-lived. A room code
-- dies after a day (0004), and keepsakes cascade away with the room that made
-- them (0005). That was right for an app about one evening and wrong for an app
-- about a year of them: an album that empties every second day is not an album.
--
-- So this adds exactly one durable thing -- a pair -- and nothing else about
-- the evening changes. Rooms stay disposable.

create table if not exists pairs (
  id         uuid primary key default gen_random_uuid(),
  -- sha-256 of the season ticket, never the ticket. The secret exists in two
  -- places: the browsers holding it, and nowhere else. We can check a ticket
  -- somebody presents; we can never produce one, which is the point.
  key_hash   text not null unique,
  created_at timestamptz not null default now()
);

-- A room may belong to an "us", so an evening can save into the album.
--
-- Nullable, and ON DELETE SET NULL rather than CASCADE: a room started before
-- pairing still works, it simply has no album to save to. And a pair being
-- deleted must never take the record of the evenings with it -- sessions
-- reference couples, and those evenings are the point of the whole app.
alter table couples add column if not exists pair_id uuid references pairs(id) on delete set null;

create table if not exists album_items (
  id           text primary key,
  pair_id      uuid not null references pairs(id) on delete cascade,
  object_key   text not null,
  -- A still for anything that moves, so scrubbing a year of memories never
  -- downloads a single video.
  poster_key   text,
  kind         text not null check (kind in ('strip', 'clip', 'photo', 'video', 'recording')),
  content_type text not null,
  bytes        bigint not null,
  -- When the memory HAPPENED, not when it was uploaded. A photo taken on
  -- Saturday and shared on Tuesday belongs to Saturday; dating it by upload
  -- would make the timeline a record of when somebody had signal.
  happened_at  timestamptz not null,
  caption      text,
  loved        boolean not null default false,
  -- Which evening produced it, when one did. Free text rather than a foreign
  -- key: the room is allowed to expire and be swept, and losing the room must
  -- not take the photograph with it.
  source_room  text,
  created_at   timestamptz not null default now()
);

-- Two orders, because two clients want different questions answered.
--
-- The reel reads in the order things HAPPENED -- that is what a timeline is.
create index if not exists album_items_by_time
  on album_items (pair_id, happened_at desc);

-- The widget reads in the order things ARRIVED, and the distinction is not
-- cosmetic. happened_at can be backdated -- that is its entire purpose -- so a
-- widget polling on it would silently never see a photograph shared on Tuesday
-- from Saturday's walk. Arrival order is the only order a cursor can trust.
create index if not exists album_items_by_arrival
  on album_items (pair_id, created_at);

-- An occasion is a title pinned to a date. Membership is the whole of
-- happened_at::date = on_date, so nothing is ever filed, nothing is ever in two
-- places, and naming an occasion months later retroactively gathers that day.
create table if not exists occasions (
  id         text primary key,
  pair_id    uuid not null references pairs(id) on delete cascade,
  title      text not null,
  on_date    date not null,
  yearly     boolean not null default false,
  -- The picture the occasion's sign shows when the reel is zoomed out too far
  -- to read the day itself. SET NULL, not CASCADE: deleting one photograph
  -- must not delete the anniversary it happened to illustrate.
  cover_item text references album_items(id) on delete set null
);

create index if not exists occasions_by_pair on occasions (pair_id, on_date);

-- No expiry on any of this, and that is the deliberate break from 0004.
--
-- findKeepsake joins couples precisely so an expired room cannot serve its
-- files. The album's reads must NOT copy that join. Saying so here because the
-- next person to read this code will otherwise assume the 24-hour rule is
-- universal -- it is a property of rooms, and an album is not a room.
