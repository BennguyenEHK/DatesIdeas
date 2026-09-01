-- The question deck for the card game.
--
-- In the database rather than a source file so questions can be added or
-- reworded without a deploy — the deck is content, and content changes on a
-- different rhythm from code.
--
-- Named card_game, not "card-game": a hyphen is not legal in a bare Postgres
-- identifier, so every query touching it would need quoting forever and one
-- forgotten pair would be a runtime error.

create table if not exists card_game (
  id         serial primary key,
  text       text not null unique,
  mood       text not null check (mood in ('light', 'us', 'deep')),
  source     text,
  created_at timestamptz not null default now()
);

-- `unique` on text is deliberate: the deck is seeded from several places and
-- the same question circulates widely, so a duplicate is likely rather than
-- hypothetical. Letting the database refuse it beats trusting the importer.

-- The deck is fetched whole, once per room, filtered by mood in the client.
-- This index serves a mood-filtered read if that ever moves server-side.
create index if not exists card_game_by_mood on card_game (mood);
