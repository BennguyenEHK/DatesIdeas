-- The two drawn layers that make a photo booth look, shared by a paired couple.
--
-- A look is deliberately a pair of files rather than a canvas document. The
-- booth only needs the finished pixels, and storing those keeps a saved look
-- independent of the browser that happened to draw it.

create table if not exists booth_looks (
  id           text primary key,
  pair_id      uuid not null references pairs(id) on delete cascade,
  name         text not null,
  shots        smallint not null check (shots between 1 and 4),
  ink          text not null,
  backdrop_key text not null,
  overlay_key  text not null,
  created_at   timestamptz not null default now()
);

-- The designer opens the newest saved look first, and both browsers always
-- read one pair at a time.
create index if not exists booth_looks_by_pair_created
  on booth_looks (pair_id, created_at desc);
