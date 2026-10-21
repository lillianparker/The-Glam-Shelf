-- The Glam Shelf — update 6
-- "All my libraries": a book you own can sit on your shelf in every library you're in
-- (including ones you join later) without adding it again. It's still ONE physical book:
-- lending it, passing it on, giving it back, "not lending", fixing its title, and removing
-- it all happen everywhere at once. Your reading status and verdict for a title also follow
-- you between libraries. Comments and the borrowing line stay separate per library.
--
-- Run this ONCE in Supabase → SQL Editor on your existing database.
-- (A brand-new project only needs schema.sql, which already includes this.)
-- Backward-compatible: existing books stay in the library they're in until you switch them on.

-------------------------------------------------------------------------------
-- Columns
-------------------------------------------------------------------------------

-- item_id: copies with the same item_id are the same physical book in different libraries.
alter table public.copies add column if not exists item_id uuid;
update public.copies set item_id = id where item_id is null;
alter table public.copies alter column item_id set not null;
-- everywhere: show this book in all of the owner's libraries.
alter table public.copies add column if not exists everywhere boolean not null default false;
create index if not exists copies_item on public.copies (item_id);

-- A new copy is its own book unless the app is deliberately placing it in another library.
create or replace function public.copy_item_default() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.item_id is null or current_setting('glam.syncing', true) is distinct from 'on' then
    new.item_id := new.id;
  end if;
  return new;
end $$;

drop trigger if exists copies_item_default on public.copies;
create trigger copies_item_default
  before insert on public.copies
  for each row execute function public.copy_item_default();

-------------------------------------------------------------------------------
-- Helpers
-------------------------------------------------------------------------------

-- The matching title in a library, created if it isn't there yet.
create or replace function public.ensure_book(gid uuid, t text, a text, creator uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare bid uuid;
begin
  insert into books (group_id, title, author, created_by) values (gid, t, coalesce(a, ''), creator)
    on conflict (group_id, lower(title), lower(author)) do nothing
    returning id into bid;
  if bid is null then
    select id into bid from books
      where group_id = gid and lower(title) = lower(t) and lower(author) = lower(coalesce(a, ''));
  end if;
  return bid;
end $$;

-- Put a book on its owner's shelf in every library they belong to that doesn't have it yet.
create or replace function public.spread_item(item uuid) returns void
language plpgsql security definer set search_path = public as $$
declare src copies; b books; g uuid; bid uuid;
begin
  select * into src from copies where item_id = item order by created_at, id limit 1;
  if not found then return; end if;
  select * into b from books where id = src.book_id;
  perform set_config('glam.syncing', 'on', true);
  for g in
    select m.group_id from group_members m
    where m.user_id = src.owner_id
      and m.group_id not in (select bk.group_id from copies c join books bk on bk.id = c.book_id where c.item_id = item)
  loop
    bid := ensure_book(g, b.title, b.author, src.owner_id);
    insert into copies (book_id, owner_id, status, lendable, lent_to_user, lent_to_name, lent_at, item_id, everywhere, created_at)
      values (bid, src.owner_id, src.status, src.lendable, src.lent_to_user, src.lent_to_name, src.lent_at, item, true, src.created_at);
    -- bring the owner's reading status for this title along
    insert into reading (user_id, book_id, status, rating, updated_at)
      select r.user_id, bid, r.status, r.rating, r.updated_at from reading r
      where r.book_id = src.book_id and r.user_id = src.owner_id
      on conflict do nothing;
  end loop;
  perform set_config('glam.syncing', 'off', true);
end $$;

-- Spread all of someone's "everywhere" books (used when they join or start a library).
create or replace function public.spread_everywhere_for(uid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare item uuid;
begin
  for item in select distinct c.item_id from copies c where c.owner_id = uid and c.everywhere loop
    perform spread_item(item);
  end loop;
end $$;

-------------------------------------------------------------------------------
-- Keeping the copies of one book in step
-------------------------------------------------------------------------------

-- Where it is / who has it / "not lending": the same in every library.
create or replace function public.sync_twins() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 or current_setting('glam.syncing', true) = 'on' then return new; end if;
  if (new.status, new.lendable, new.lent_to_user, new.lent_to_name, new.lent_at)
     is distinct from (old.status, old.lendable, old.lent_to_user, old.lent_to_name, old.lent_at) then
    update copies
      set status = new.status, lendable = new.lendable, lent_to_user = new.lent_to_user,
          lent_to_name = new.lent_to_name, lent_at = new.lent_at
      where item_id = new.item_id and id <> new.id;
  end if;
  return new;
end $$;

drop trigger if exists copies_sync_twins on public.copies;
create trigger copies_sync_twins
  after update on public.copies
  for each row execute function public.sync_twins();

-- Removing your book removes it from every library.
create or replace function public.delete_twins() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 or current_setting('glam.syncing', true) = 'on' then return old; end if;
  delete from copies where item_id = old.item_id and id <> old.id;
  return old;
end $$;

drop trigger if exists copies_delete_twins on public.copies;
create trigger copies_delete_twins
  after delete on public.copies
  for each row execute function public.delete_twins();

-- Your status and verdict for a title follow you to every library you're in that has it.
create or replace function public.mirror_reading() returns trigger
language plpgsql security definer set search_path = public as $$
declare r reading; b books; other uuid;
begin
  if pg_trigger_depth() > 1 or current_setting('glam.syncing', true) = 'on' then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  select * into b from books where id = r.book_id;
  if not found then return coalesce(new, old); end if;
  for other in
    select bk.id from books bk
    join group_members m on m.group_id = bk.group_id and m.user_id = r.user_id
    where bk.id <> b.id and lower(bk.title) = lower(b.title) and lower(bk.author) = lower(b.author)
  loop
    if tg_op = 'DELETE' then
      delete from reading where user_id = r.user_id and book_id = other;
    else
      insert into reading (user_id, book_id, status, rating, updated_at)
        values (r.user_id, other, r.status, r.rating, r.updated_at)
        on conflict (user_id, book_id) do update
          set status = excluded.status, rating = excluded.rating, updated_at = excluded.updated_at;
    end if;
  end loop;
  return coalesce(new, old);
end $$;

drop trigger if exists reading_mirror on public.reading;
create trigger reading_mirror
  after insert or update or delete on public.reading
  for each row execute function public.mirror_reading();

-------------------------------------------------------------------------------
-- Actions the website calls
-------------------------------------------------------------------------------

-- Add a copy you own; optionally show it in all your libraries.
drop function if exists public.add_copy(uuid, text, text);
create or replace function public.add_copy(gid uuid, book_title text, book_author text, everywhere boolean default false)
returns uuid
language plpgsql security definer set search_path = public as $$
declare bid uuid; cid uuid; item uuid;
begin
  if not is_member(gid) then raise exception 'You are not in this group'; end if;
  bid := ensure_book(gid, trim(book_title), coalesce(trim(book_author), ''), auth.uid());
  insert into copies (book_id, owner_id, everywhere) values (bid, auth.uid(), coalesce(everywhere, false))
    returning id, item_id into cid, item;
  if everywhere then perform spread_item(item); end if;
  return cid;
end $$;

-- Switch one of your books between "all my libraries" and "just this library".
-- Off keeps it only in the library you switched it off from.
create or replace function public.set_everywhere(cid uuid, on_ boolean) returns void
language plpgsql security definer set search_path = public as $$
declare c copies;
begin
  select * into c from copies where id = cid;
  if not found or c.owner_id is distinct from auth.uid() then raise exception 'Only the owner can change this'; end if;
  update copies set everywhere = on_ where item_id = c.item_id;
  if on_ then
    perform spread_item(c.item_id);
  else
    perform set_config('glam.syncing', 'on', true);
    delete from copies where item_id = c.item_id and id <> c.id;
    perform set_config('glam.syncing', 'off', true);
  end if;
end $$;

-- Every book of yours in this library: all libraries on (or off). Returns how many changed.
create or replace function public.set_all_everywhere(gid uuid, on_ boolean) returns int
language plpgsql security definer set search_path = public as $$
declare c record; n int := 0;
begin
  if not is_member(gid) then raise exception 'You are not in this group'; end if;
  for c in
    select cp.id from copies cp join books b on b.id = cp.book_id
    where b.group_id = gid and cp.owner_id = auth.uid() and cp.everywhere is distinct from on_
  loop
    perform set_everywhere(c.id, on_);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Fixing a title or author fixes it in every library the book is in.
-- (The single-library logic from update 3 becomes edit_copy_one.)
create or replace function public.edit_copy_one(cid uuid, new_title text, new_author text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare c copies; old_bid uuid; gid uuid; target uuid; others int;
begin
  select * into c from copies where id = cid;
  if not found or c.owner_id is distinct from auth.uid() then
    raise exception 'Only the owner can edit this copy';
  end if;
  new_title := trim(coalesce(new_title, ''));
  new_author := trim(coalesce(new_author, ''));
  if new_title = '' then raise exception 'Give the book a title'; end if;
  if char_length(new_title) > 300 or char_length(new_author) > 200 then
    raise exception 'That title or author is too long';
  end if;

  old_bid := c.book_id;
  gid := book_group(old_bid);
  select id into target from books
    where group_id = gid and lower(title) = lower(new_title) and lower(author) = lower(new_author);
  select count(*) into others from copies where book_id = old_bid and id <> cid;

  if target = old_bid or (target is null and others = 0) then
    update books set title = new_title, author = new_author where id = old_bid;
    return old_bid;
  end if;

  if target is null then
    insert into books (group_id, title, author, created_by)
      values (gid, new_title, new_author, auth.uid())
      returning id into target;
  end if;

  update copies set book_id = target where id = cid;

  if others = 0 then
    insert into reading (user_id, book_id, status, rating, updated_at)
      select user_id, target, status, rating, updated_at from reading where book_id = old_bid
      on conflict do nothing;
    delete from books where id = old_bid;
  else
    insert into reading (user_id, book_id, status, rating, updated_at)
      select user_id, target, status, rating, updated_at from reading
      where book_id = old_bid and user_id = auth.uid()
      on conflict do nothing;
    delete from reading where book_id = old_bid and user_id = auth.uid();
  end if;
  return target;
end $$;

create or replace function public.edit_copy(cid uuid, new_title text, new_author text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare c copies; twin uuid; result uuid;
begin
  select * into c from copies where id = cid;
  if not found or c.owner_id is distinct from auth.uid() then
    raise exception 'Only the owner can edit this copy';
  end if;
  perform set_config('glam.syncing', 'on', true);
  result := edit_copy_one(cid, new_title, new_author);
  for twin in select id from copies where item_id = c.item_id and id <> cid loop
    perform edit_copy_one(twin, new_title, new_author);
  end loop;
  perform set_config('glam.syncing', 'off', true);
  return result;
end $$;

-- Starting or joining a library brings your "all my libraries" books with you.
create or replace function public.create_group(group_name text) returns public.groups
language plpgsql security definer set search_path = public as $$
declare g groups;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  insert into groups (name, created_by) values (trim(group_name), auth.uid()) returning * into g;
  insert into group_members (group_id, user_id) values (g.id, auth.uid());
  perform spread_everywhere_for(auth.uid());
  return g;
end $$;

create or replace function public.join_group(code text) returns public.groups
language plpgsql security definer set search_path = public as $$
declare g groups;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into g from groups where invite_code = lower(trim(code));
  if not found then raise exception 'That invite link isn''t valid. Ask your friend to send it again.'; end if;
  insert into group_members (group_id, user_id) values (g.id, auth.uid()) on conflict do nothing;
  perform spread_everywhere_for(auth.uid());
  return g;
end $$;

-------------------------------------------------------------------------------
-- Permissions: helpers are internal; the website calls only the actions
-------------------------------------------------------------------------------

revoke execute on function public.ensure_book(uuid, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.spread_item(uuid) from public, anon, authenticated;
revoke execute on function public.spread_everywhere_for(uuid) from public, anon, authenticated;
revoke execute on function public.edit_copy_one(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.add_copy(uuid, text, text, boolean) from public, anon;
revoke execute on function public.set_everywhere(uuid, boolean) from public, anon;
revoke execute on function public.set_all_everywhere(uuid, boolean) from public, anon;
grant execute on function public.add_copy(uuid, text, text, boolean) to authenticated;
grant execute on function public.set_everywhere(uuid, boolean) to authenticated;
grant execute on function public.set_all_everywhere(uuid, boolean) to authenticated;
