-- Glam Bookshelf — update 13
-- 1. Moods follow a book into all your libraries (like your reading status does).
-- 2. "Put all my books in every library" also repairs books that are set to "in all my
--    libraries" but are missing from one of them (before, it skipped those).
-- Run this ONCE in Supabase → SQL Editor, AFTER update-12.sql.
-- (A brand-new project only needs schema.sql, which already includes this.)

-- 1. Moods: the same title + author in your other libraries gets the same moods.
create or replace function public.mirror_moods() returns trigger
language plpgsql security definer set search_path = public as $$
declare r book_moods; b books; other uuid;
begin
  if pg_trigger_depth() > 1 or current_setting('glam.syncing', true) = 'on' then return null; end if;
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  select * into b from books where id = r.book_id;
  if not found then return null; end if;
  for other in
    select bk.id from books bk
    join group_members m on m.group_id = bk.group_id and m.user_id = r.user_id
    where bk.id <> b.id and lower(bk.title) = lower(b.title) and lower(bk.author) = lower(b.author)
  loop
    if tg_op = 'DELETE' then
      delete from book_moods where user_id = r.user_id and book_id = other and mood = r.mood;
    elsif exists (select 1 from reading where user_id = r.user_id and book_id = other and status = 'read') then
      begin
        insert into book_moods (user_id, book_id, mood) values (r.user_id, other, r.mood) on conflict do nothing;
      exception when others then null;   -- that copy of the book already has 3 moods: leave it
      end;
    end if;
  end loop;
  return null;
end $$;

drop trigger if exists book_moods_mirror on public.book_moods;
create trigger book_moods_mirror
  after insert or delete on public.book_moods
  for each row execute function public.mirror_moods();

-- Moods already picked: copy them to the same book in your other libraries.
do $$
declare r record;
begin
  for r in
    select distinct m.user_id, bk.id as other, m.mood
    from book_moods m
    join books b on b.id = m.book_id
    join books bk on bk.id <> b.id and lower(bk.title) = lower(b.title) and lower(bk.author) = lower(b.author)
    join group_members gm on gm.group_id = bk.group_id and gm.user_id = m.user_id
    join reading rd on rd.user_id = m.user_id and rd.book_id = bk.id and rd.status = 'read'
  loop
    begin
      insert into book_moods (user_id, book_id, mood) values (r.user_id, r.other, r.mood) on conflict do nothing;
    exception when others then null;
    end;
  end loop;
end $$;

-- 2. "Put all my books in every library": also fill in anything missing.
create or replace function public.set_all_everywhere(gid uuid, on_ boolean) returns int
language plpgsql security definer set search_path = public as $$
declare c record; n int := 0; before_count int;
begin
  if not is_member(gid) then raise exception 'You are not in this group'; end if;
  for c in
    select cp.id, cp.item_id, cp.everywhere from copies cp join books b on b.id = cp.book_id
    where b.group_id = gid and cp.owner_id = auth.uid()
  loop
    if c.everywhere is distinct from on_ then
      perform set_everywhere(c.id, on_);
      n := n + 1;
    elsif on_ then
      -- already "in all my libraries": make sure it really is
      select count(*) into before_count from copies where item_id = c.item_id;
      perform spread_item(c.item_id);
      if (select count(*) from copies where item_id = c.item_id) > before_count then n := n + 1; end if;
    end if;
  end loop;
  return n;
end $$;
