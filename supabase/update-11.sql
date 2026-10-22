-- Glam Bookshelf — update 11
-- "Want to read" and "get in line" are the same thing:
--   • getting in line for a copy marks the book Want to read
--   • marking Want to read on a book you don't own puts you in line for a copy
--     (one that's home with nobody waiting if there is one, otherwise the shortest line)
--   • leaving the line yourself, or un-marking Want to read, undoes the other
--   • when the book is handed to you, it moves to Reading
-- (If an owner takes you off their line, or stops lending, your Want to read stays.)
-- Run this ONCE in Supabase → SQL Editor, AFTER update-10.sql.
-- (A brand-new project only needs schema.sql, which already includes this.)

-- 1. The line → Want to read
create or replace function public.want_from_line() returns trigger
language plpgsql security definer set search_path = public as $$
declare bid uuid;
begin
  -- only for changes people make directly (not the knock-on changes below), so nothing loops
  if pg_trigger_depth() > 1 or current_setting('glam.syncing', true) = 'on' then return null; end if;
  if tg_op = 'INSERT' then
    select book_id into bid from copies where id = new.copy_id;
    if bid is null then return null; end if;
    insert into reading (user_id, book_id, status, rating, updated_at)
      values (new.user_id, bid, 'want', null, now())
      on conflict (user_id, book_id) do update set status = 'want', rating = null, updated_at = now()
      where reading.status = 'dnf';
  else
    -- the owner taking you off the line doesn't change what you want to read
    if auth.uid() is distinct from old.user_id then return null; end if;
    select book_id into bid from copies where id = old.copy_id;
    if bid is null then return null; end if;
    if exists (select 1 from queue q join copies c on c.id = q.copy_id where c.book_id = bid and q.user_id = old.user_id) then return null; end if;
    if exists (select 1 from copies where book_id = bid and lent_to_user = old.user_id) then return null; end if;
    delete from reading where user_id = old.user_id and book_id = bid and status = 'want';
  end if;
  return null;
end $$;

drop trigger if exists queue_want on public.queue;
create trigger queue_want
  after insert or delete on public.queue
  for each row execute function public.want_from_line();

-- 2. Want to read → the line
create or replace function public.line_from_want() returns trigger
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if pg_trigger_depth() > 1 or current_setting('glam.syncing', true) = 'on' then return null; end if;
  if tg_op <> 'DELETE' and new.status = 'want' and (tg_op = 'INSERT' or old.status is distinct from 'want') then
    -- you own it or already have it: nothing to wait for
    if exists (select 1 from copies where book_id = new.book_id and (owner_id = new.user_id or lent_to_user = new.user_id)) then return null; end if;
    -- already in a line for it
    if exists (select 1 from queue q join copies c on c.id = q.copy_id where c.book_id = new.book_id and q.user_id = new.user_id) then return null; end if;
    select c.id into cid from copies c
      where c.book_id = new.book_id and c.lendable and c.owner_id <> new.user_id
      order by (c.status = 'home' and not exists (select 1 from queue q where q.copy_id = c.id)) desc,
               (select count(*) from queue q where q.copy_id = c.id),
               c.created_at
      limit 1;
    if cid is not null then
      insert into queue (copy_id, user_id) values (cid, new.user_id) on conflict do nothing;
    end if;
  elsif (tg_op = 'UPDATE' and old.status = 'want' and new.status is distinct from 'want')
     or (tg_op = 'DELETE' and old.status = 'want') then
    delete from queue q using copies c
      where c.id = q.copy_id and c.book_id = old.book_id and q.user_id = old.user_id;
  end if;
  return null;
end $$;

drop trigger if exists reading_line on public.reading;
create trigger reading_line
  after insert or update or delete on public.reading
  for each row execute function public.line_from_want();

-- 3. Handed the book → Reading
create or replace function public.reading_on_handoff() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 or current_setting('glam.syncing', true) = 'on' then return null; end if;
  if new.lent_to_user is null or new.lent_to_user is not distinct from old.lent_to_user or new.lent_to_user = new.owner_id then
    return null;
  end if;
  insert into reading (user_id, book_id, status, rating, updated_at)
    values (new.lent_to_user, new.book_id, 'reading', null, now())
    on conflict (user_id, book_id) do update set status = 'reading', rating = null, updated_at = now()
    where reading.status in ('want', 'dnf');
  return null;
end $$;

drop trigger if exists copies_reading_handoff on public.copies;
create trigger copies_reading_handoff
  after update on public.copies
  for each row execute function public.reading_on_handoff();

-- 4. Today's lines: everyone already waiting for a book now has it on their Want to read.
insert into public.reading (user_id, book_id, status, rating, updated_at)
  select distinct q.user_id, c.book_id, 'want', null::text, now()
  from public.queue q join public.copies c on c.id = q.copy_id
  on conflict (user_id, book_id) do nothing;

-- (Optional, not run: also put everyone's existing Want to reads in line, the way it works from now on.
--  If you want that, select the lines below, remove the "-- " at the start of each, and run just that part.)
-- insert into public.queue (copy_id, user_id)
--   select distinct on (r.user_id, r.book_id) c.id, r.user_id
--   from public.reading r join public.copies c on c.book_id = r.book_id
--   where r.status = 'want' and c.lendable and c.owner_id <> r.user_id
--     and not exists (select 1 from public.copies o where o.book_id = r.book_id and (o.owner_id = r.user_id or o.lent_to_user = r.user_id))
--     and not exists (select 1 from public.queue q join public.copies c2 on c2.id = q.copy_id where c2.book_id = r.book_id and q.user_id = r.user_id)
--   order by r.user_id, r.book_id, (c.status = 'home') desc, c.created_at
-- on conflict do nothing;
