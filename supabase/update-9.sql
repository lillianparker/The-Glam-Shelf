-- Glam Bookshelf — update 9
-- Book covers: each book remembers its cover from Open Library (looked up once, then saved).
-- Run this ONCE in Supabase → SQL Editor, AFTER update-8.sql.
-- (A brand-new project only needs schema.sql, which already includes this.)

-- cover_id: Open Library's number for the cover picture (empty = no cover found)
-- cover_looked: true once we've searched, so a book without a cover isn't searched again and again
alter table public.books add column if not exists cover_id bigint;
alter table public.books add column if not exists cover_looked boolean not null default false;

-- (Members can already update books, which is how the cover gets saved. Nothing else to change.)
