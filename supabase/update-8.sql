-- The Glam Shelf — update 8
-- "Stack the shelf" leaderboard: each person's best score in each library.
-- Run this ONCE in Supabase → SQL Editor, AFTER update-7.sql.
-- (A brand-new project only needs schema.sql, which already includes this.)

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
