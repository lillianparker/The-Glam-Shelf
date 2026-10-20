-- The Glam Shelf — update 2
-- Adds the "It was good" verdict and the borrowing history.
-- Run this ONCE in Supabase → SQL Editor on your existing database.
-- (A brand-new project only needs schema.sql, which already includes this.)

-- 1. Four verdicts: loved it / it was good / it was fine / not for me
alter table public.reading drop constraint reading_rating_check;
alter table public.reading add constraint reading_rating_check
  check (rating in ('up', 'good', 'meh', 'down'));

-- 2. Borrowing history: one row each time a copy goes out
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

-- Start the history with whoever has a book right now.
insert into public.loans (copy_id, borrower_id, borrower_name, lent_at)
  select id, lent_to_user, lent_to_name, coalesce(lent_at, now())
  from public.copies where status = 'lent';

alter publication supabase_realtime add table public.loans;
