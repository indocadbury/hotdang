-- HotDang database setup. Paste this whole file into Supabase → SQL Editor → Run.
-- Safe to run again: it only creates things that don't exist yet.

-- Public profile for each signed-in user
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique check (char_length(username) between 2 and 24),
  created_at timestamptz not null default now()
);

-- Hotdogs eaten (powers the global leaderboard)
create table if not exists public.eats (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles on delete cascade default auth.uid(),
  spot_id text not null,
  spot_name text,
  created_at timestamptz not null default now()
);

-- Photo posts of hotdogs
create table if not exists public.posts (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles on delete cascade default auth.uid(),
  spot_id text not null,
  spot_name text,
  photo_path text not null,
  caption text check (char_length(caption) <= 280),
  city text,
  lat double precision,
  lng double precision,
  created_at timestamptz not null default now()
);

-- Like (+1) or dislike (-1), one per user per post
create table if not exists public.post_votes (
  post_id bigint references public.posts on delete cascade,
  user_id uuid references public.profiles on delete cascade default auth.uid(),
  value smallint not null check (value in (-1, 1)),
  primary key (post_id, user_id)
);

create table if not exists public.post_comments (
  id bigint generated always as identity primary key,
  post_id bigint not null references public.posts on delete cascade,
  user_id uuid not null references public.profiles on delete cascade default auth.uid(),
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

-- Reviews of spots
create table if not exists public.reviews (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles on delete cascade default auth.uid(),
  spot_id text not null,
  stars smallint not null check (stars between 1 and 5),
  body text check (char_length(body) <= 1000),
  created_at timestamptz not null default now()
);

-- Which special dogs a spot sells (cheese, chilli, footlong...)
create table if not exists public.spot_dogs (
  spot_id text not null,
  dog text not null,
  user_id uuid not null references public.profiles on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (spot_id, dog, user_id)
);

-- Spots added by the community
create table if not exists public.spots (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles on delete cascade default auth.uid(),
  name text not null check (char_length(name) between 1 and 80),
  type text not null check (type in ('stand', 'restaurant', 'shelf')),
  lat double precision not null,
  lng double precision not null,
  price numeric,
  created_at timestamptz not null default now()
);

-- Leaderboard view
create or replace view public.leaderboard with (security_invoker = true) as
  select p.id, p.username, count(e.id)::int as eaten
  from public.profiles p join public.eats e on e.user_id = p.id
  group by p.id, p.username
  order by eaten desc;

-- Post scores view
create or replace view public.post_feed with (security_invoker = true) as
  select po.*, pr.username,
    coalesce((select sum(value) from public.post_votes v where v.post_id = po.id), 0)::int as score,
    (select count(*) from public.post_votes v where v.post_id = po.id and v.value = 1)::int as likes,
    (select count(*) from public.post_votes v where v.post_id = po.id and v.value = -1)::int as dislikes,
    (select count(*) from public.post_comments c where c.post_id = po.id)::int as comments
  from public.posts po join public.profiles pr on pr.id = po.user_id;

-- Row level security: everyone can read, people can only change their own rows
do $$
declare t text;
begin
  foreach t in array array['profiles','eats','posts','post_votes','post_comments','reviews','spot_dogs','spots'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "read all" on public.%I', t);
    execute format('create policy "read all" on public.%I for select using (true)', t);
    execute format('drop policy if exists "insert own" on public.%I', t);
    execute format('drop policy if exists "update own" on public.%I', t);
    execute format('drop policy if exists "delete own" on public.%I', t);
    if t = 'profiles' then
      execute 'create policy "insert own" on public.profiles for insert with check (auth.uid() = id)';
      execute 'create policy "update own" on public.profiles for update using (auth.uid() = id)';
    else
      execute format('create policy "insert own" on public.%I for insert with check (auth.uid() = user_id)', t);
      execute format('create policy "update own" on public.%I for update using (auth.uid() = user_id)', t);
      execute format('create policy "delete own" on public.%I for delete using (auth.uid() = user_id)', t);
    end if;
  end loop;
end $$;

-- Photo storage: public to view, users upload into a folder named after their id
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists "photos read" on storage.objects;
create policy "photos read" on storage.objects for select using (bucket_id = 'photos');
drop policy if exists "photos upload own" on storage.objects;
create policy "photos upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "photos delete own" on storage.objects;
create policy "photos delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- Explicit API access (works whether or not "Automatically expose new tables" was ticked).
-- Row level security above still decides which rows each person can read or change.
grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to anon, authenticated;
grant insert, update, delete on public.profiles, public.eats, public.posts, public.post_votes,
  public.post_comments, public.reviews, public.spot_dogs, public.spots to authenticated;
