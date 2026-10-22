-- Glam Bookshelf — update 10
-- The index-card book pop-up: "DNF'd" as a reading status, and choosing your copy's spine color.
-- Run this ONCE in Supabase → SQL Editor, AFTER update-9.sql.
-- (A brand-new project only needs schema.sql, which already includes this.)

-- 1. "DNF'd" (did not finish) joins want / reading / read.
alter table public.reading drop constraint if exists reading_status_check;
alter table public.reading add constraint reading_status_check
  check (status in ('read', 'reading', 'want', 'dnf'));

-- 2. Spine color: empty = picked automatically (like now); otherwise the owner's choice.
alter table public.copies add column if not exists tone text;
alter table public.copies drop constraint if exists copies_tone_check;
alter table public.copies add constraint copies_tone_check check (tone is null or tone in
  ('pink', 'cream', 'wine', 'gold', 'sage', 'blue', 'plum', 'navy', 'forest', 'aubergine', 'cocoa'));

-- Only the owner can change it, and it changes in all their libraries at once.
create or replace function public.set_spine_tone(cid uuid, new_tone text) returns void
language plpgsql security definer set search_path = public as $$
declare c copies;
begin
  select * into c from copies where id = cid;
  if not found or c.owner_id is distinct from auth.uid() then
    raise exception 'Only the owner can change the spine color';
  end if;
  perform set_config('glam.syncing', 'on', true);
  update copies set tone = new_tone where item_id = c.item_id and owner_id = auth.uid();
  perform set_config('glam.syncing', 'off', true);
end $$;

revoke execute on function public.set_spine_tone(uuid, text) from public, anon;
grant execute on function public.set_spine_tone(uuid, text) to authenticated;
