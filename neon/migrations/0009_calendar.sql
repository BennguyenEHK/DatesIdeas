-- Planning days together across two timezones.
--
-- The whole difficulty of this table is in one question: whose seven o'clock?
--
-- Two answers are both right, for different things. A date night is a MOMENT --
-- one instant, seen as 20:00 in London and 03:00 in Hanoi, and both are correct.
-- "I am at work nine to five" is not a moment; it is a local time that recurs,
-- and it stays 09:00 for the person who owns it even when the clocks change.
--
-- So a block stores an instant AND the zone it was written in. The instant is
-- what both of you sort and compare by; the zone is what makes a repeat land on
-- the right local hour next month, and what a reminder is phrased in.

create table if not exists time_blocks (
  id         text primary key,
  pair_id    uuid not null references pairs(id) on delete cascade,
  title      text not null,
  note       text,

  starts_at  timestamptz not null,
  ends_at    timestamptz not null,

  -- An IANA zone, e.g. "Europe/London". The zone of whoever wrote the block.
  -- Recurrence is expanded in it, which is what keeps a weekly 09:00 at 09:00
  -- across a daylight-saving change instead of quietly becoming 08:00.
  zone       text not null,

  -- Whose time this is: the literal 'both', or a person's display name.
  --
  -- Deliberately NOT 'mine' and 'yours'. Those are relative to whoever is
  -- reading, and both of you read the same rows -- so the same block would have
  -- to mean two different things depending on the browser, and a new phone with
  -- a fresh device id would read its owner's own blocks as somebody else's.
  -- A name is absolute, it is already in localStorage (see getDisplayName), and
  -- it is what a person would have written on a paper calendar anyway.
  owner      text not null default 'both',

  repeat     text not null default 'none'
             check (repeat in ('none', 'daily', 'weekly', 'fortnightly', 'monthly')),
  -- The last civil date a repeat may land on. Null means it goes on forever,
  -- which is a legitimate thing to mean about a standing Tuesday.
  repeat_until date,

  -- Minutes before the start to send a push, or null for none.
  remind_minutes int check (remind_minutes is null or remind_minutes between 0 and 10080),
  -- The occurrence a reminder was last sent for, so a sweep running every few
  -- minutes cannot send the same reminder twice -- and so a repeating block
  -- can be reminded about again next week without being reminded again today.
  reminded_for timestamptz,

  created_at timestamptz not null default now()
);

-- Every read is "this pair's blocks around this window", a range scan on
-- starts_at within one pair.
create index if not exists time_blocks_by_pair on time_blocks (pair_id, starts_at);

-- The reminder sweep asks a different question -- "anything due, across all
-- pairs" -- so it gets its own partial index, which stays off every row that
-- can never match.
create index if not exists time_blocks_reminders
  on time_blocks (starts_at)
  where remind_minutes is not null;
