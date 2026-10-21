-- The Glam Shelf database setup
-- Paste this whole file into Supabase → SQL Editor → New query, then click Run.
-- Run it once on a fresh project.

-------------------------------------------------------------------------------
-- Tables
-------------------------------------------------------------------------------

-- One row per person, created the first time they sign in and pick a name.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  avatar text check (avatar is null or avatar ~ '^[a-z0-9-]{1,40}$'),  -- the object on your shelf, e.g. 'cactus'
  created_at timestamptz not null default now()
);

-- A friend circle. Everyone in a group shares one library.
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  invite_code text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- A title, stored once per group. "The Bell Jar" by Sylvia Plath is one book,
-- however many friends own a copy.
create table public.books (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  author text not null default '' check (char_length(author) <= 200),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index books_unique_per_group
  on public.books (group_id, lower(title), lower(author));

-- A physical copy someone owns, and where it is right now.
create table public.copies (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'home' check (status in ('home', 'lent')),
  lendable boolean not null default true,                               -- owner's "not lending this one" switch
  lent_to_user uuid references public.profiles(id) on delete set null,  -- a friend on The Glam Shelf
  lent_to_name text check (char_length(lent_to_name) <= 60),            -- or anyone else, by name
  lent_at timestamptz,
  created_at timestamptz not null default now()
);
create index copies_book_id on public.copies (book_id);

-- Each person's status for a title. "Neither" = no row.
-- Once you've read it you can rate it: up, meh (neutral) or down.
create table public.reading (
  user_id uuid not null references public.profiles(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  status text not null check (status in ('read', 'reading', 'want')),
  rating text check (rating in ('up', 'good', 'meh', 'down')),
  updated_at timestamptz not null default now(),
  primary key (user_id, book_id),
  check (rating is null or status = 'read')
);
create index reading_book_id on public.reading (book_id);

-- The line to borrow a copy next. Getting in line is borrowing (no approval).
create table public.queue (
  copy_id uuid not null references public.copies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  sort_key double precision not null default extract(epoch from now()),
  joined_at timestamptz not null default now(),
  primary key (copy_id, user_id)
);
create index queue_copy_order on public.queue (copy_id, sort_key);

-------------------------------------------------------------------------------
-- Helper functions used by the access rules
-------------------------------------------------------------------------------

create or replace function public.is_member(gid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from group_members where group_id = gid and user_id = auth.uid());
$$;

create or replace function public.book_group(bid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select group_id from books where id = bid;
$$;

create or replace function public.copy_group(cid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select b.group_id from copies c join books b on b.id = c.book_id where c.id = cid;
$$;

create or replace function public.shares_group(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from group_members a
    join group_members b on a.group_id = b.group_id
    where a.user_id = auth.uid() and b.user_id = other
  );
$$;

-------------------------------------------------------------------------------
-- Access rules: you only ever see your own groups' libraries
-------------------------------------------------------------------------------

alter table public.profiles      enable row level security;
alter table public.groups        enable row level security;
alter table public.group_members enable row level security;
alter table public.books         enable row level security;
alter table public.copies        enable row level security;
alter table public.reading       enable row level security;
alter table public.queue         enable row level security;

-- Profiles: see yourself and people in your groups; edit only yourself.
create policy "profiles: read self and groupmates" on public.profiles
  for select to authenticated using (id = auth.uid() or public.shares_group(id));
create policy "profiles: create own" on public.profiles
  for insert to authenticated with check (id = auth.uid());
create policy "profiles: edit own" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Groups: members can see and rename their group. Creating and joining go
-- through the create_group / join_group functions below.
create policy "groups: members read" on public.groups
  for select to authenticated using (public.is_member(id));
create policy "groups: members rename" on public.groups
  for update to authenticated using (public.is_member(id)) with check (public.is_member(id));

create policy "members: read own groups" on public.group_members
  for select to authenticated using (public.is_member(group_id));
create policy "members: leave" on public.group_members
  for delete to authenticated using (user_id = auth.uid());

-- Books: members read and fix typos. New books go through add_copy().
create policy "books: members read" on public.books
  for select to authenticated using (public.is_member(group_id));
create policy "books: members edit" on public.books
  for update to authenticated using (public.is_member(group_id)) with check (public.is_member(group_id));

-- Copies: members read; you add and remove only your own copies.
-- Any member can update where a copy is (so a friend can tap
-- "I borrowed this" or "I gave it back"). Only the location columns can change.
create policy "copies: members read" on public.copies
  for select to authenticated using (public.is_member(public.book_group(book_id)));
create policy "copies: add own" on public.copies
  for insert to authenticated
  with check (owner_id = auth.uid() and public.is_member(public.book_group(book_id)));
create policy "copies: members update location" on public.copies
  for update to authenticated
  using (public.is_member(public.book_group(book_id)))
  with check (public.is_member(public.book_group(book_id)));
create policy "copies: owner removes" on public.copies
  for delete to authenticated using (owner_id = auth.uid());

revoke update on public.copies from authenticated;
grant update (status, lendable, lent_to_user, lent_to_name, lent_at) on public.copies to authenticated;

-- Only the owner flips "not lending", and nobody else can lend out a copy
-- that's switched off.
create or replace function public.guard_copy_update() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.lendable is distinct from old.lendable and auth.uid() is distinct from old.owner_id then
    raise exception 'Only the owner can change whether this copy is lent out';
  end if;
  if not new.lendable and new.status = 'lent'
     and (old.status = 'home' or new.lent_to_user is distinct from old.lent_to_user or new.lent_to_name is distinct from old.lent_to_name)
     and auth.uid() is distinct from old.owner_id then
    raise exception 'The owner isn''t lending this copy right now';
  end if;
  return new;
end $$;

create trigger copies_guard_update
  before update on public.copies
  for each row execute function public.guard_copy_update();

-- Tidy the line after a copy changes hands or stops being lent.
create or replace function public.tidy_queue() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.lent_to_user is not null then
    delete from queue where copy_id = new.id and user_id = new.lent_to_user;
  end if;
  if old.lendable and not new.lendable then
    delete from queue where copy_id = new.id;
  end if;
  return new;
end $$;

create trigger copies_tidy_queue
  after update on public.copies
  for each row execute function public.tidy_queue();

-- Reading status: members read everyone's; you change only your own.
create policy "reading: members read" on public.reading
  for select to authenticated using (public.is_member(public.book_group(book_id)));
create policy "reading: add own" on public.reading
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_member(public.book_group(book_id)));
create policy "reading: edit own" on public.reading
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "reading: clear own" on public.reading
  for delete to authenticated using (user_id = auth.uid());

-- The line: members see it; you leave it yourself, or the owner takes you off.
-- Joining and reordering go through join_line / move_in_line below.
create policy "queue: members read" on public.queue
  for select to authenticated using (public.is_member(public.copy_group(copy_id)));
create policy "queue: leave or owner removes" on public.queue
  for delete to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.copies c where c.id = copy_id and c.owner_id = auth.uid()));

revoke insert, update on public.queue from authenticated;

-------------------------------------------------------------------------------
-- Actions the website calls
-------------------------------------------------------------------------------

-- Start a new friend circle; you become its first member.
create or replace function public.create_group(group_name text) returns public.groups
language plpgsql security definer set search_path = public as $$
declare g groups;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  insert into groups (name, created_by) values (trim(group_name), auth.uid()) returning * into g;
  insert into group_members (group_id, user_id) values (g.id, auth.uid());
  return g;
end $$;

-- Join a circle from its invite link.
create or replace function public.join_group(code text) returns public.groups
language plpgsql security definer set search_path = public as $$
declare g groups;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into g from groups where invite_code = lower(trim(code));
  if not found then raise exception 'That invite link isn''t valid. Ask your friend to send it again.'; end if;
  insert into group_members (group_id, user_id) values (g.id, auth.uid()) on conflict do nothing;
  return g;
end $$;

-- Add a copy you own. Reuses the title if someone in the group already has it.
create or replace function public.add_copy(gid uuid, book_title text, book_author text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare bid uuid; cid uuid;
begin
  if not is_member(gid) then raise exception 'You are not in this group'; end if;
  insert into books (group_id, title, author, created_by)
    values (gid, trim(book_title), coalesce(trim(book_author), ''), auth.uid())
    on conflict (group_id, lower(title), lower(author)) do nothing
    returning id into bid;
  if bid is null then
    select id into bid from books
      where group_id = gid
        and lower(title) = lower(trim(book_title))
        and lower(author) = lower(coalesce(trim(book_author), ''));
  end if;
  insert into copies (book_id, owner_id) values (bid, auth.uid()) returning id into cid;
  return cid;
end $$;

-- Get in line for a copy. No approval needed.
create or replace function public.join_line(cid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c copies;
begin
  select * into c from copies where id = cid;
  if not found or not is_member(copy_group(cid)) then raise exception 'That book isn''t in your library'; end if;
  if c.owner_id = auth.uid() then raise exception 'This is your own copy'; end if;
  if c.lent_to_user = auth.uid() then raise exception 'You already have this copy'; end if;
  if not c.lendable then raise exception 'The owner isn''t lending this copy right now'; end if;
  insert into queue (copy_id, user_id) values (cid, auth.uid()) on conflict do nothing;
end $$;

-- Owner moves someone up (-1) or down (+1) the line.
create or replace function public.move_in_line(cid uuid, uid uuid, direction int) returns void
language plpgsql security definer set search_path = public as $$
declare me_key double precision; other_uid uuid; other_key double precision;
begin
  if not exists (select 1 from copies where id = cid and owner_id = auth.uid()) then
    raise exception 'Only the owner can reorder the line';
  end if;
  select sort_key into me_key from queue where copy_id = cid and user_id = uid;
  if me_key is null then return; end if;
  if direction < 0 then
    select user_id, sort_key into other_uid, other_key from queue
      where copy_id = cid and sort_key < me_key order by sort_key desc limit 1;
  else
    select user_id, sort_key into other_uid, other_key from queue
      where copy_id = cid and sort_key > me_key order by sort_key asc limit 1;
  end if;
  if other_uid is null then return; end if;
  update queue set sort_key = other_key where copy_id = cid and user_id = uid;
  update queue set sort_key = me_key where copy_id = cid and user_id = other_uid;
end $$;

-- Hand a copy to the first person in line. The person who has it (or the
-- owner) calls this; it records the new holder and takes them off the line.
create or replace function public.pass_on(cid uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare c copies; nxt uuid;
begin
  select * into c from copies where id = cid;
  if not found then raise exception 'That copy no longer exists'; end if;
  if auth.uid() is distinct from c.owner_id and auth.uid() is distinct from c.lent_to_user then
    raise exception 'Only the owner or whoever has the book can pass it on';
  end if;
  select user_id into nxt from queue where copy_id = cid order by sort_key, joined_at limit 1;
  if nxt is null then raise exception 'No one is in line for this copy'; end if;
  update copies set status = 'lent', lent_to_user = nxt, lent_to_name = null, lent_at = now() where id = cid;
  return nxt;
end $$;

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

-- When the last copy of a title is removed, remove the title too.
create or replace function public.drop_orphan_book() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from books b
    where b.id = old.book_id
      and not exists (select 1 from copies c where c.book_id = old.book_id);
  return old;
end $$;

create trigger copies_drop_orphan_book
  after delete on public.copies
  for each row execute function public.drop_orphan_book();

revoke execute on function public.create_group(text) from public, anon;
revoke execute on function public.join_group(text) from public, anon;
revoke execute on function public.add_copy(uuid, text, text) from public, anon;
revoke execute on function public.join_line(uuid) from public, anon;
revoke execute on function public.move_in_line(uuid, uuid, int) from public, anon;
revoke execute on function public.pass_on(uuid) from public, anon;
grant execute on function public.create_group(text) to authenticated;
grant execute on function public.join_group(text) to authenticated;
grant execute on function public.add_copy(uuid, text, text) to authenticated;
grant execute on function public.join_line(uuid) to authenticated;
grant execute on function public.move_in_line(uuid, uuid, int) to authenticated;
grant execute on function public.pass_on(uuid) to authenticated;

-------------------------------------------------------------------------------
-- Borrowing history: one row each time a copy goes out
create table public.loans (
  id uuid primary key default gen_random_uuid(),
  copy_id uuid not null references public.copies(id) on delete cascade,
  borrower_id uuid references public.profiles(id) on delete set null,  -- a friend on The Glam Shelf
  borrower_name text,                                                   -- or anyone else, by name
  lent_at timestamptz not null default now(),
  returned_at timestamptz                                               -- empty while they still have it
);
create index loans_copy on public.loans (copy_id, lent_at);

alter table public.loans enable row level security;
create policy "loans: members read" on public.loans
  for select to authenticated using (public.is_member(public.copy_group(copy_id)));
revoke insert, update, delete on public.loans from authenticated;

-- Record every hand-off automatically whenever a copy's location changes.
create or replace function public.log_loan() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status
     or new.lent_to_user is distinct from old.lent_to_user
     or new.lent_to_name is distinct from old.lent_to_name then
    if old.status = 'lent' then
      update loans set returned_at = now() where copy_id = new.id and returned_at is null;
    end if;
    if new.status = 'lent' then
      insert into loans (copy_id, borrower_id, borrower_name, lent_at)
        values (new.id, new.lent_to_user, new.lent_to_name, coalesce(new.lent_at, now()));
    end if;
  end if;
  return new;
end $$;

create trigger copies_log_loan
  after update on public.copies
  for each row execute function public.log_loan();

-------------------------------------------------------------------------------
-- Comments on each copy
-------------------------------------------------------------------------------

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

-------------------------------------------------------------------------------
-- Live updates: friends' changes appear without refreshing
-------------------------------------------------------------------------------

alter publication supabase_realtime add table public.books, public.copies, public.reading, public.queue, public.loans, public.comments, public.group_members, public.profiles;

-------------------------------------------------------------------------------
-- "All my libraries" (update 6)
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

-------------------------------------------------------------------------------
-- "This is actually a friend's" (update 7)
-------------------------------------------------------------------------------

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

-------------------------------------------------------------------------------
-- "Stack the shelf" leaderboard (update 8)
-------------------------------------------------------------------------------

create table if not exists public.game_scores (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  best     int  not null default 0 check (best between 0 and 100000),
  best_at  timestamptz not null default now(),  -- when they reached it (first to a score ranks higher)
  games    int  not null default 0,             -- how many rounds they've played here
  primary key (group_id, user_id)
);

alter table public.game_scores enable row level security;

-- Everyone in the library can see the board.
drop policy if exists "game_scores: members read" on public.game_scores;
create policy "game_scores: members read" on public.game_scores
  for select to authenticated using (public.is_member(group_id));

-- Scores only change through record_score below, which keeps your best and never lowers it.
revoke insert, update, delete on public.game_scores from anon, authenticated;

-- Called when a round ends. Returns your best in this library.
create or replace function public.record_score(gid uuid, score int) returns int
language plpgsql security definer set search_path = public as $$
declare result int;
begin
  if auth.uid() is null or not public.is_member(gid) then
    raise exception 'You need to be in this library to play here';
  end if;
  if score is null or score < 0 or score > 100000 then
    raise exception 'That score doesn''t look right';
  end if;
  insert into game_scores as g (group_id, user_id, best, best_at, games)
  values (gid, auth.uid(), score, now(), 1)
  on conflict (group_id, user_id) do update set
    games   = g.games + 1,
    best_at = case when excluded.best > g.best then now() else g.best_at end,
    best    = greatest(g.best, excluded.best)
  returning best into result;
  return result;
end $$;

revoke execute on function public.record_score(uuid, int) from public, anon;
grant execute on function public.record_score(uuid, int) to authenticated;

-- Live updates: the board changes as friends play.
alter publication supabase_realtime add table public.game_scores;
