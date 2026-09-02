-- Gives a room code a day to live.
--
-- A code is an unauthenticated key. Anyone who ever sees one can rejoin that
-- room forever, and there is no way to revoke it — the only remedy today is to
-- abandon the code and agree on another. An expiry turns that permanent
-- exposure into a bounded one, which is the real reason this exists. It is not
-- a storage measure: a room is a six-character code and two timestamps, and
-- the table that actually grows (signals) already sweeps itself at 15 minutes.
--
-- Rooms are therefore marked dead, never deleted. sessions references
-- couples ON DELETE CASCADE, so deleting an expired room would take the
-- evenings spent in it with it — and those are the point of the whole app.

alter table couples add column if not exists expires_at timestamptz;

-- Existing rooms get a fresh day rather than created_at + 24h, which would
-- retire the room in use the moment this is applied. One soft landing, then
-- the ordinary rule.
update couples set expires_at = now() + interval '24 hours' where expires_at is null;

alter table couples alter column expires_at set default now() + interval '24 hours';

alter table couples alter column expires_at set not null;

-- No index on expires_at on purpose. Every read is "this one code, is it still
-- open?", which the primary key already answers; an index would only serve a
-- sweep, and there is no sweep.
