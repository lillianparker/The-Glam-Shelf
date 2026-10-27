-- Glam Bookshelf — update 14
-- One title + author = one book, per person:
--   • adding a book you already have in that library opens your copy instead of making a second one
--   • your copies with the same title + author in different libraries are one physical book
--     (lend it in one library, it shows as lent in all of them)
--   • duplicates you already have are merged: their notes, borrowing history and line move to the
--     copy that's kept, nothing is lost
-- Capitals and extra spaces don't matter ("Flowers for Algernon" = "Flowers For  Algernon").
-- Run this ONCE in Supabase → SQL Editor, AFTER update-13.sql.
-- (A brand-new project only needs schema.sql, which already includes this.)

-- How two titles (or authors) are compared: lower case, spaces trimmed and squeezed.
create or replace function public.book_key(t text) returns text
language sql immutable as $$
  select regexp_replace(lower(btrim(coalesce(t, ''))), '\s+', ' ', 'g')
$$;

-- Tidy one person's books: link same-title copies across libraries, merge duplicates in a library,
-- keep each physical book in one place, and spread the ones set to "all my libraries".
-- Returns how many things it fixed.
create or replace function public.tidy_owner_books(uid uuid) returns int
language plpgsql security definer set search_path = public as $$
declare k record; d record; keep copies; holder copies; item uuid; n int := 0;
begin
  perform set_config('glam.syncing', 'on', true);

  -- 1. the same title + author in different libraries: one physical book
  for k in
    select book_key(b.title) as tk, book_key(b.author) as ak, bool_or(c.everywhere) as ev
    from copies c join books b on b.id = c.book_id
    where c.owner_id = uid
    group by 1, 2
    having count(distinct c.item_id) > 1
  loop
    select c.item_id into item from copies c join books b on b.id = c.book_id
      where c.owner_id = uid and book_key(b.title) = k.tk and book_key(b.author) = k.ak
      order by c.everywhere desc, c.created_at, c.id limit 1;
    update copies c set item_id = item, everywhere = k.ev
      from books b
      where b.id = c.book_id and c.owner_id = uid and book_key(b.title) = k.tk and book_key(b.author) = k.ak;
    n := n + 1;
  end loop;

  -- 2. two of your copies of the same book in one library: merge into one
  for d in
    select c.book_id from copies c where c.owner_id = uid group by c.book_id having count(*) > 1
  loop
    select * into keep from copies
      where book_id = d.book_id and owner_id = uid
      order by (status = 'lent') desc, everywhere desc, created_at, id limit 1;
    -- the line: anyone waiting moves to the kept copy (once)
    update queue q set copy_id = keep.id
      from copies o
      where o.id = q.copy_id and o.book_id = d.book_id and o.owner_id = uid and o.id <> keep.id
        and not exists (select 1 from queue q2 where q2.copy_id = keep.id and q2.user_id = q.user_id);
    delete from queue q using copies o
      where o.id = q.copy_id and o.book_id = d.book_id and o.owner_id = uid and o.id <> keep.id;
    -- borrowing history and notes in the margins move too
    update loans set copy_id = keep.id
      where copy_id in (select id from copies where book_id = d.book_id and owner_id = uid and id <> keep.id);
    update comments set copy_id = keep.id
      where copy_id in (select id from copies where book_id = d.book_id and owner_id = uid and id <> keep.id);
    delete from copies where book_id = d.book_id and owner_id = uid and id <> keep.id;
    n := n + 1;
  end loop;

  -- 3. one physical book is in one place: its copies all say where it is
  for item in
    select c.item_id from copies c where c.owner_id = uid
    group by c.item_id
    having count(distinct (c.status, c.lent_to_user, c.lent_to_name)) > 1
  loop
    select * into holder from copies where item_id = item
      order by (status = 'lent') desc, lent_at desc nulls last limit 1;
    update copies set status = holder.status, lent_to_user = holder.lent_to_user,
        lent_to_name = holder.lent_to_name, lent_at = holder.lent_at
      where item_id = item and id <> holder.id;
  end loop;

  perform set_config('glam.syncing', 'off', true);

  -- 4. books set to "all my libraries" go everywhere
  for item in select distinct c.item_id from copies c where c.owner_id = uid and c.everywhere loop
    perform spread_item(item);
  end loop;
  return n;
end $$;

revoke execute on function public.tidy_owner_books(uuid) from public, anon, authenticated;

-- Adding a book: if you already have it in this library, that's the one (no second copy).
-- Otherwise it's added, and linked to the same title in your other libraries.
create or replace function public.add_copy(gid uuid, book_title text, book_author text, everywhere boolean default false)
returns uuid
language plpgsql security definer set search_path = public as $$
declare bid uuid; cid uuid; item uuid;
begin
  if not is_member(gid) then raise exception 'You are not in this group'; end if;
  select c.id into cid
    from copies c join books b on b.id = c.book_id
    where b.group_id = gid and c.owner_id = auth.uid()
      and book_key(b.title) = book_key(book_title) and book_key(b.author) = book_key(book_author)
    limit 1;
  if cid is not null then
    if everywhere then perform set_everywhere(cid, true); end if;
    return cid;
  end if;
  bid := ensure_book(gid, btrim(book_title), coalesce(btrim(book_author), ''), auth.uid());
  insert into copies (book_id, owner_id, everywhere) values (bid, auth.uid(), coalesce(everywhere, false))
    returning id, item_id into cid, item;
  if everywhere then perform spread_item(item); end if;
  perform tidy_owner_books(auth.uid());
  -- (tidying never removes the copy just added: it's the only one of its title in this library)
  return cid;
end $$;

-- Fixing a title or author can make it match a book you already have: tidy up afterwards.
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
  perform tidy_owner_books(auth.uid());
  return result;
end $$;

-- Giving a copy to a friend who already has the same book: it merges into theirs.
create or replace function public.give_copy_tidy() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.owner_id is distinct from old.owner_id then perform tidy_owner_books(new.owner_id); end if;
  return null;
end $$;
drop trigger if exists copies_owner_tidy on public.copies;
create trigger copies_owner_tidy
  after update of owner_id on public.copies
  for each row execute function public.give_copy_tidy();

-- Tidy everyone's books now.
select public.tidy_owner_books(owner_id) from (select distinct owner_id from public.copies) owners;
