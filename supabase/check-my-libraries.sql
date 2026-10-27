-- Glam Bookshelf — which of my books aren't in all my libraries?
-- Read-only: this only looks, it changes nothing. Paste it into Supabase → SQL Editor and click Run.
-- Put your sign-in email on the line below if it's different.

with me as (
  select id from auth.users where lower(email) = lower('lily.parker1125@icloud.com')
),
my_libraries as (
  select g.id, g.name from groups g join group_members m on m.group_id = g.id where m.user_id = (select id from me)
),
my_books as (
  select c.item_id, b.title, b.author, g.name as library, c.everywhere
  from copies c
  join books b on b.id = c.book_id
  join groups g on g.id = b.group_id
  where c.owner_id = (select id from me)
)
select
  min(title)  as title,
  min(author) as author,
  string_agg(library, ', ' order by library)                        as "in these libraries",
  (select string_agg(l.name, ', ' order by l.name) from my_libraries l
     where l.name not in (select library from my_books mb where mb.item_id = my_books.item_id)) as "missing from",
  case when bool_or(everywhere) then 'yes (should be everywhere: a gap)'
       else 'no (only meant for this library)' end                  as "set to all my libraries?"
from my_books
group by item_id   -- one row per physical book, even if its title is capitalized differently in each library
having count(*) < (select count(*) from my_libraries)
order by 1;
