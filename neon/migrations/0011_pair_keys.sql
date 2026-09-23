-- One album, several devices.
--
-- Until now a pair had exactly one key, held in pairs.key_hash, so the only
-- way onto a second device was carrying the /us/<ticket> link there. This
-- gives each device a key of its own. They all open the same album, and any
-- one of them can be taken away without signing out the others.
--
-- pair_id is uuid because pairs(id) is uuid (0007); a foreign key has to match
-- the column it points at.

create table if not exists pair_keys (
  -- Random, and only ever used to name a key for revocation. It is not a
  -- secret: knowing it opens nothing.
  id           text primary key,
  pair_id      uuid not null references pairs(id) on delete cascade,
  -- sha-256 of the device's ticket, never the ticket, for the reason 0007
  -- gives for pairs.key_hash.
  key_hash     text not null unique,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz
);

create index if not exists pair_keys_by_pair on pair_keys (pair_id);

-- Every device paired today stays paired. Its key is copied across with the
-- pair's own creation date, and a rerun of this migration copies nothing twice
-- because key_hash is unique.
--
-- pairs.key_hash is kept for one release as a read-only fallback, so a device
-- whose key somehow missed this copy is still let in, and is dropped later.
insert into pair_keys (id, pair_id, key_hash, created_at)
select substr(md5(gen_random_uuid()::text), 1, 16), id, key_hash, created_at
from pairs
on conflict do nothing;

-- A one-time invitation from a paired device to one that is not.
--
-- The code travels only over the room's data channel and is hashed here the
-- same way a ticket is, so reading this table lets nobody in. Five minutes,
-- once: used_at is set by the same statement that checks it, so two devices
-- racing with the same code cannot both win.
create table if not exists pair_invites (
  code_hash  text primary key,
  pair_id    uuid not null references pairs(id) on delete cascade,
  expires_at timestamptz not null,
  used_at    timestamptz
);
