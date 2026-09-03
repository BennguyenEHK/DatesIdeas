-- Gives a saved strip a short name a QR code can carry.
--
-- The code used to hold the signed storage link itself, six hundred-odd
-- characters of it, which makes a dense QR that a phone camera has to work at.
-- A ten-character id makes a code that scans on the first try, and the signed
-- link is minted fresh when someone actually opens it — so a keepsake page
-- never serves a link that has quietly gone stale in the intervening hours.
--
-- The row is also what lets a keepsake be shown on a PAGE rather than handed
-- over as a raw file. That page is the only place a phone can be offered its
-- own "save to Photos", which is the whole reason any of this exists.

create table if not exists keepsakes (
  id           text primary key,
  -- ON DELETE CASCADE, unlike sessions, because there is nothing here worth
  -- keeping once the room is gone: the object it points at is in a bucket
  -- nobody is sweeping, and a row pointing at a file nobody can reach is
  -- worse than no row at all.
  room_code    text not null references couples(code) on delete cascade,
  object_key   text not null,
  kind         text not null,
  content_type text not null,
  created_at   timestamptz not null default now()
);

-- Every read is "this one id, is its room still open?", which is the primary
-- key plus a join on couples.code — both already indexed. The one query that
-- is not is a sweep by room, and that is what this index is for.
create index if not exists keepsakes_room_code_idx on keepsakes (room_code);
