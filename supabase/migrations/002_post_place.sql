-- Adds the city and location to photo posts, so the Photos page can show where each dog is.
alter table public.posts add column if not exists city text, add column if not exists lat double precision, add column if not exists lng double precision;
drop view if exists public.post_feed;
create view public.post_feed with (security_invoker = true) as
  select po.*, pr.username,
    coalesce((select sum(value) from public.post_votes v where v.post_id = po.id), 0)::int as score,
    (select count(*) from public.post_votes v where v.post_id = po.id and v.value = 1)::int as likes,
    (select count(*) from public.post_votes v where v.post_id = po.id and v.value = -1)::int as dislikes,
    (select count(*) from public.post_comments c where c.post_id = po.id)::int as comments
  from public.posts po join public.profiles pr on pr.id = po.user_id;
grant select on public.post_feed to anon, authenticated;
