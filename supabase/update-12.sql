-- Glam Bookshelf — update 12
-- Moods: once you've read a book, tag it with up to 3 moods ("still thinking about it", "beach read"…).
-- Run this ONCE in Supabase → SQL Editor, AFTER update-11.sql.
-- (A brand-new project only needs schema.sql, which already includes this.)

create table if not exists public.book_moods (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  book_id    uuid not null references public.books(id) on delete cascade,
  mood       text not null check (mood in (
    'still-thinking', 'cant-put-down', 'beautiful-writing', 'beach-read', 'classic',
    'ugly-cried', 'made-me-laugh', 'need-to-talk', 'slow-burn', 'mind-bending', 'learned-something')),
  created_at timestamptz not null default now(),
  primary key (user_id, book_id, mood)
);
create index if not exists book_moods_book on public.book_moods (book_id);

alter table public.book_moods enable row level security;

-- Everyone in the library sees the moods; you add and remove only your own,
-- and only on a book you've marked Read.
drop policy if exists "moods: members read" on public.book_moods;
create policy "moods: members read" on public.book_moods
  for select to authenticated using (public.is_member(public.book_group(book_id)));
drop policy if exists "moods: add own after reading" on public.book_moods;
create policy "moods: add own after reading" on public.book_moods
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.is_member(public.book_group(book_id))
    and exists (select 1 from public.reading r where r.user_id = auth.uid() and r.book_id = book_moods.book_id and r.status = 'read')
  );
drop policy if exists "moods: remove own" on public.book_moods;
create policy "moods: remove own" on public.book_moods
  for delete to authenticated using (user_id = auth.uid());
revoke update on public.book_moods from authenticated;

-- Up to 3 moods per person per book.
create or replace function public.moods_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from book_moods where user_id = new.user_id and book_id = new.book_id) >= 3 then
    raise exception 'Pick up to 3 moods';
  end if;
  return new;
end $$;
drop trigger if exists book_moods_limit on public.book_moods;
create trigger book_moods_limit
  before insert on public.book_moods
  for each row execute function public.moods_limit();

-- Moods belong to having read it: if you un-mark Read, your moods for that book go too.
create or replace function public.moods_follow_reading() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' or new.status is distinct from 'read' then
    delete from book_moods where user_id = old.user_id and book_id = old.book_id;
  end if;
  return null;
end $$;
drop trigger if exists reading_moods on public.reading;
create trigger reading_moods
  after update or delete on public.reading
  for each row execute function public.moods_follow_reading();

-- Live updates: friends' moods show up without refreshing.
alter publication supabase_realtime add table public.book_moods;
