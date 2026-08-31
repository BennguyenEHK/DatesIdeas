-- DatesIdea v1 schema (Neon / Lakebase Postgres).
--
-- Unlike the Supabase setup this replaced, the browser never reaches Postgres
-- directly: DATABASE_URL is a server secret and every query goes through a
-- Next.js route handler. So there is no anon role and no RLS here — the
-- authorization boundary is the route handler, not the database.

create table if not exists couples (
  code        text primary key,
  created_at  timestamptz not null default now()
);

create table if not exists sessions (
  id          uuid primary key default gen_random_uuid(),
  couple_code text not null references couples(code) on delete cascade,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  memes_sent  jsonb not null default '{}'::jsonb
);

create table if not exists participants (
  session_id  uuid not null references sessions(id) on delete cascade,
  identity    uuid not null,
  name        text,
  primary key (session_id, identity)
);

create index if not exists sessions_by_couple
  on sessions (couple_code, started_at desc);

-- WebRTC signalling. Neon has no realtime pub/sub, so peers exchange
-- offer/answer/ICE by writing rows here and polling for the other side's.
--
-- These rows are transport, not data. They live for the length of a handshake
-- (seconds), are read once, and are swept on write. Nothing here is worth
-- keeping, which is why there is no retention beyond the sweep below.
create table if not exists signals (
  id            bigserial primary key,
  room_code     text not null,
  from_identity uuid not null,
  payload       jsonb not null,
  created_at    timestamptz not null default now()
);

-- The polling read is always "rows for this room, from the other peer, after
-- my cursor" — this index serves it directly.
create index if not exists signals_by_room
  on signals (room_code, id);

create index if not exists signals_by_age
  on signals (created_at);
