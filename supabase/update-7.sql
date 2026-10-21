-- The Glam Shelf — update 7
-- "This is actually a friend's": move a copy on your shelf to a friend's shelf.
-- Run this ONCE in Supabase → SQL Editor, AFTER update-6.sql.
-- (A brand-new project only needs schema.sql, which already includes this.)

-- The copy keeps its notes, borrowing history and line, and becomes the friend's book.
-- It's taken out of your other libraries (it isn't your book any more), and if the friend
-- had it borrowed, it's simply back at their home now.
create or replace function public.give_copy(cid uuid, new_owner uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c copies; gid uuid;
begin
  select * into c from copies where id = cid;
  if not found or c.owner_id is distinct from auth.uid() then
    raise exception 'Only the owner can move this book';
  end if;
  if new_owner is null or new_owner = c.owner_id then return; end if;
  gid := book_group(c.book_id);
  if not exists (select 1 from group_members where group_id = gid and user_id = new_owner) then
    raise exception 'They need to be in this library first';
  end if;

  perform set_config('glam.syncing', 'on', true);
  -- it leaves your other libraries
  delete from copies where item_id = c.item_id and id <> c.id;
  -- and becomes theirs, here
  update copies set
    owner_id = new_owner,
    everywhere = false,
    status = case when lent_to_user = new_owner then 'home' else status end,
    lent_at = case when lent_to_user = new_owner then null else lent_at end,
    lent_to_user = case when lent_to_user = new_owner then null else lent_to_user end
  where id = cid;
  delete from queue where copy_id = cid and user_id = new_owner;
  perform set_config('glam.syncing', 'off', true);
end $$;

revoke execute on function public.give_copy(uuid, uuid) from public, anon;
grant execute on function public.give_copy(uuid, uuid) to authenticated;
