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
  status text not null check (status in ('read', 'want')),
  rating text check (rating in ('up', 'meh', 'down')),
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
-- Live updates: friends' changes appear without refreshing
-------------------------------------------------------------------------------

alter publication supabase_realtime add table public.books, public.copies, public.reading, public.queue, public.group_members;
