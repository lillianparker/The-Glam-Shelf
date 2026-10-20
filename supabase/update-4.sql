-- The Glam Shelf — update 4
-- Adds comments on each copy (shown as "[Owner]'s comments" on the book listing).
-- Run this ONCE in Supabase → SQL Editor on your existing database.
-- (A brand-new project only needs schema.sql, which already includes this.)
-- Backward-compatible: it only adds a new table; nothing existing changes.

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  copy_id uuid not null references public.copies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index comments_copy on public.comments (copy_id, created_at);

alter table public.comments enable row level security;

-- Everyone in the library can read and post; you post only as yourself.
create policy "comments: members read" on public.comments
  for select to authenticated using (public.is_member(public.copy_group(copy_id)));
create policy "comments: members post as themselves" on public.comments
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_member(public.copy_group(copy_id)));
-- You can delete your own comment; a copy's owner can delete any comment on it.
create policy "comments: author or copy owner deletes" on public.comments
  for delete to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.copies c where c.id = copy_id and c.owner_id = auth.uid()));

-- Comments can't be edited after posting (delete and repost instead).
revoke update on public.comments from authenticated;

alter publication supabase_realtime add table public.comments;
