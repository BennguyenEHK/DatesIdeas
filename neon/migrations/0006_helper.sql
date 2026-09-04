-- Keeps the deployed room app pointed at the helper running on a home PC.
--
-- A Cloudflare quick tunnel gets a new address each time its helper restarts.
-- The helper records that address here, so the room discovers the live tunnel
-- instead of relying on a hostname that quietly went stale between dates.
--
-- The id check makes a single row by construction rather than by convention:
-- every registration can only name the one endpoint the room is allowed to use.

create table if not exists helper_endpoint (
  id         int primary key default 1 check (id = 1),
  url        text not null,
  updated_at timestamptz not null default now()
);
