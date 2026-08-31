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

alter table couples      enable row level security;
alter table sessions     enable row level security;
alter table participants enable row level security;

-- The room code is the capability. Knowing it is the authorization; there are
-- no accounts. Codes are 6 chars from a 31-symbol alphabet (~887M values),
-- which is adequate for a two-person app and nothing more.
create policy couples_anon_all on couples
  for all to anon using (true) with check (true);

create policy sessions_anon_all on sessions
  for all to anon using (true) with check (true);

create policy participants_anon_all on participants
  for all to anon using (true) with check (true);
