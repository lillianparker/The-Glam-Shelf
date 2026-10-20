-- The Glam Shelf — update 3
-- Lets you fix the title or author on your own copy.
-- Run this ONCE in Supabase → SQL Editor on your existing database.
-- (A brand-new project only needs schema.sql, which already includes this.)

-- Fix the title/author of a copy you own.
-- If you're the only owner, the title is simply corrected (everyone's
-- read/want/verdicts stay on it). If a friend owns a copy under the old
-- details, only your copy moves, so you never change someone else's book.
-- If the corrected details match a title already on the shelf, your copy
-- joins that one.
create or replace function public.edit_copy(cid uuid, new_title text, new_author text)
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

  -- Same title (maybe new capitalisation), or you're the only owner: fix it in place.
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
    -- Nobody else owns the old title: carry everyone's statuses over and remove it.
    insert into reading (user_id, book_id, status, rating, updated_at)
      select user_id, target, status, rating, updated_at from reading where book_id = old_bid
      on conflict do nothing;
    delete from books where id = old_bid;
  else
    -- Friends still own the old title: bring only your own status along.
    insert into reading (user_id, book_id, status, rating, updated_at)
      select user_id, target, status, rating, updated_at from reading
      where book_id = old_bid and user_id = auth.uid()
      on conflict do nothing;
    delete from reading where book_id = old_bid and user_id = auth.uid();
  end if;
  return target;
end $$;

revoke execute on function public.edit_copy(uuid, text, text) from public, anon;
grant execute on function public.edit_copy(uuid, text, text) to authenticated;
