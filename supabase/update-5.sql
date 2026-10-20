-- The Glam Shelf — update 5
-- Adds a profile avatar (the little object that sits on your shelf).
-- Run this ONCE in Supabase → SQL Editor on your existing database.
-- (A brand-new project only needs schema.sql, which already includes this.)
-- Backward-compatible: adds one optional column; nobody has an avatar until they pick one.

-- The avatar's name, e.g. 'cactus' or 'blue-perfume'. The pictures live in the
-- website (public/avatars/), so new ones can be added later without a database change.
alter table public.profiles
  add column if not exists avatar text
  check (avatar is null or avatar ~ '^[a-z0-9-]{1,40}$');

-- You can already edit only your own profile (existing rule), so nothing else changes.

-- Friends' avatar changes show up live.
alter publication supabase_realtime add table public.profiles;

