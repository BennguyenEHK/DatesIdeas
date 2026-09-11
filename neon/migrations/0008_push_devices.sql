-- Where a push can actually be delivered.
--
-- A subscription is not a person and not a phone: it is one browser's channel
-- to one push service, and the same person has a different one on each device
-- and a new one if they clear site data. So this table is keyed by the channel
-- rather than by anything about who owns it.

create table if not exists pair_devices (
  id           uuid primary key default gen_random_uuid(),
  pair_id      uuid not null references pairs(id) on delete cascade,

  -- The endpoint IS the identity of a subscription. Unique across the whole
  -- table, not per pair: a phone that opens a second album must move to the
  -- new pair rather than quietly receive both.
  endpoint     text not null unique,

  -- The two halves of the keying material the browser generated. Without them
  -- a push cannot be encrypted, and an unencrypted one is refused outright.
  p256dh       text not null,
  auth         text not null,

  -- "Ben's phone". Free text, set by whoever subscribed, shown only back to
  -- the pair itself so they can tell two devices apart when revoking one.
  label        text,

  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),

  -- When the push service last told us this channel is gone (404/410). Kept
  -- rather than deleted on the first failure: a phone that is merely off for a
  -- week should not have to re-subscribe, and only a definitive refusal from
  -- the service means the channel is really dead.
  failed_at    timestamptz
);

-- Every read is "all the devices of this pair, except the one that just
-- uploaded", which this serves directly.
create index if not exists pair_devices_by_pair on pair_devices (pair_id);
