-- The Lookbook: a paired couple's pieces of clothing, and the outfits they
-- arrange from them. See docs/superpowers/specs/2026-09-27-lookbook-design.md.
--
-- A piece is a photograph plus one tap of what it is. An outfit keeps its
-- board as a small JSON layout rather than a picture: pieces move, and a
-- stored picture would be out of date the moment one did.

create table if not exists lookbook_pieces (
  id           text primary key,
  pair_id      uuid not null references pairs(id) on delete cascade,
  object_key   text not null,
  content_type text not null,
  bytes        integer not null check (bytes > 0),
  kind         text not null,
  label        text not null default '',
  added_by     text not null,
  created_at   timestamptz not null default now()
);

-- The wardrobe opens newest first, one pair at a time.
create index if not exists lookbook_pieces_by_pair_created
  on lookbook_pieces (pair_id, created_at desc);

create table if not exists lookbook_outfits (
  id          text primary key,
  pair_id     uuid not null references pairs(id) on delete cascade,
  name        text not null,
  -- The day to wear it. The calendar reads outfits by this, so it is a date
  -- and not free text.
  wear_on     date,
  note        text not null default '',
  created_by  text not null,
  loved_by    text[] not null default '{}',
  -- [{ pieceId, x, y, scale, z }]: positions as fractions of the board.
  layout      jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists lookbook_outfits_by_pair_updated
  on lookbook_outfits (pair_id, updated_at desc);

-- The calendar asks for a pair's outfits within a week.
create index if not exists lookbook_outfits_by_pair_wear_on
  on lookbook_outfits (pair_id, wear_on)
  where wear_on is not null;
