begin;

create extension if not exists pgcrypto;

create table if not exists public.youtube_playlist_registry (
  id uuid primary key default gen_random_uuid(),
  account_key text not null,
  playlist_key text not null,
  youtube_playlist_id text,
  title text not null,
  description text not null default '',
  privacy text not null default 'public' check (privacy in ('public', 'unlisted', 'private')),
  configuration_version text not null,
  status text not null default 'pending'
    check (status in ('pending', 'creating', 'active', 'retry', 'review')),
  claim_token uuid,
  claimed_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_retry_at timestamptz,
  last_error text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (account_key, playlist_key)
);

create table if not exists public.youtube_playlist_assignments (
  id uuid primary key default gen_random_uuid(),
  publication_id text not null references public.video_publications(id) on delete cascade,
  account_key text not null,
  playlist_key text not null,
  youtube_playlist_id text,
  youtube_playlist_item_id text,
  configuration_version text not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'verified', 'retry', 'review', 'skipped')),
  claim_token uuid,
  claimed_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_retry_at timestamptz,
  last_error text not null default '',
  verified_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (publication_id, playlist_key)
);

create index if not exists youtube_playlist_registry_status_retry_idx
  on public.youtube_playlist_registry (account_key, status, next_retry_at)
  where status in ('pending', 'creating', 'retry');

create index if not exists youtube_playlist_assignments_due_idx
  on public.youtube_playlist_assignments (status, next_retry_at, created_at)
  where status in ('pending', 'processing', 'retry');

create index if not exists youtube_playlist_assignments_channel_idx
  on public.youtube_playlist_assignments (account_key, status, next_retry_at);

create or replace function public.set_youtube_playlist_summary(
  p_publication_id text,
  p_summary jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.video_publications
  set metadata = jsonb_set(
    coalesce(metadata, '{}'::jsonb),
    '{youtube_playlists}',
    coalesce(p_summary, '{}'::jsonb),
    true
  )
  where id = p_publication_id;
$$;

drop trigger if exists set_youtube_playlist_registry_updated_at
  on public.youtube_playlist_registry;
create trigger set_youtube_playlist_registry_updated_at
before update on public.youtube_playlist_registry
for each row execute function public.set_video_updated_at();

drop trigger if exists set_youtube_playlist_assignments_updated_at
  on public.youtube_playlist_assignments;
create trigger set_youtube_playlist_assignments_updated_at
before update on public.youtube_playlist_assignments
for each row execute function public.set_video_updated_at();

alter table public.youtube_playlist_registry enable row level security;
alter table public.youtube_playlist_assignments enable row level security;

revoke all on public.youtube_playlist_registry from anon, authenticated, service_role;
revoke all on public.youtube_playlist_assignments from anon, authenticated, service_role;
grant all on public.youtube_playlist_registry to postgres;
grant all on public.youtube_playlist_assignments to postgres;
grant select, insert, update on public.youtube_playlist_registry to service_role;
grant select, insert, update on public.youtube_playlist_assignments to service_role;
revoke all on function public.set_youtube_playlist_summary(text, jsonb) from public, anon, authenticated;
grant execute on function public.set_youtube_playlist_summary(text, jsonb) to postgres, service_role;

commit;
