-- Draft for the isolated test Supabase project only. Do not apply to Production.
create table public.community_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 80),
  body text not null check (char_length(btrim(body)) between 1 and 3000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index community_posts_created_at_idx on public.community_posts (created_at desc);
alter table public.community_posts enable row level security;

revoke all on public.community_posts from anon, authenticated;
grant select on public.community_posts to anon, authenticated;
grant insert (title, body) on public.community_posts to authenticated;
grant delete on public.community_posts to authenticated;

create policy "community public read"
on public.community_posts for select
to anon, authenticated
using (true);

create policy "community kakao author insert"
on public.community_posts for insert
to authenticated
with check (
  author_id = (select auth.uid())
  and (select auth.jwt()->>'is_anonymous') = 'false'
  and (select auth.jwt()->'app_metadata'->'providers') ? 'kakao'
);

create policy "community kakao author delete"
on public.community_posts for delete
to authenticated
using (
  author_id = (select auth.uid())
  and (select auth.jwt()->>'is_anonymous') = 'false'
  and (select auth.jwt()->'app_metadata'->'providers') ? 'kakao'
);
