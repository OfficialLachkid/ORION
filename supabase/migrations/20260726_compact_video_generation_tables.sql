begin;

create extension if not exists pgcrypto;

create or replace function public.set_video_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

do $$
declare
  table_name text;
  table_rows bigint;
  total_rows bigint := 0;
begin
  foreach table_name in array array[
    'video_channels',
    'video_subjects',
    'video_products',
    'video_generations',
    'video_generation_subjects',
    'video_source_snapshots',
    'video_subject_scores',
    'video_assets',
    'video_media_locations',
    'video_script_jobs',
    'video_script_variants',
    'video_script_revisions',
    'video_voice_jobs',
    'video_caption_jobs',
    'video_render_jobs',
    'video_render_clips',
    'video_approvals',
    'video_affiliate_links',
    'video_publications',
    'video_publication_affiliate_links',
    'video_analytics_snapshots'
  ]
  loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('select count(*) from public.%I', table_name) into table_rows;
      total_rows := total_rows + table_rows;
    end if;
  end loop;

  if total_rows > 0 then
    raise exception
      'Video schema compaction stopped: legacy tables contain % row(s). Export or migrate them before retrying.',
      total_rows;
  end if;
end;
$$;

drop view if exists public.video_generation_overview;

drop table if exists public.video_analytics_snapshots;
drop table if exists public.video_publication_affiliate_links;
drop table if exists public.video_publications;
drop table if exists public.video_affiliate_links;
drop table if exists public.video_approvals;
drop table if exists public.video_render_clips;
drop table if exists public.video_render_jobs;
drop table if exists public.video_caption_jobs;
drop table if exists public.video_voice_jobs;
drop table if exists public.video_script_revisions;
drop table if exists public.video_script_variants;
drop table if exists public.video_script_jobs;
drop table if exists public.video_media_locations;
drop table if exists public.video_assets;
drop table if exists public.video_subject_scores;
drop table if exists public.video_source_snapshots;
drop table if exists public.video_generation_subjects;
drop table if exists public.video_products;
drop table if exists public.video_subjects;
drop table if exists public.video_generations;
drop table if exists public.video_channels;

create table public.video_channels (
  id text primary key,
  name text not null,
  niche text not null default '',
  content_lane text not null default '',
  platform text not null default '',
  account_key text not null default '',
  language text not null default 'en-US',
  status text not null default 'active',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (platform, account_key)
);

create table public.videos (
  id text primary key,
  channel_id text references public.video_channels(id) on delete set null,
  title text not null default '',
  niche text not null default '',
  content_lane text not null default '',
  template_key text not null default '',
  status text not null default 'planned',
  subjects jsonb not null default '[]'::jsonb,
  source_data jsonb not null default '{}'::jsonb,
  score jsonb not null default '{}'::jsonb,
  scripts jsonb not null default '[]'::jsonb,
  selected_script jsonb not null default '{}'::jsonb,
  voice jsonb not null default '{}'::jsonb,
  captions jsonb not null default '{}'::jsonb,
  render jsonb not null default '{}'::jsonb,
  approvals jsonb not null default '[]'::jsonb,
  affiliate_links jsonb not null default '[]'::jsonb,
  workflow jsonb not null default '{}'::jsonb,
  archive jsonb not null default '{}'::jsonb,
  cost jsonb not null default '{"currency":"USD","estimated":0,"incurred":0}'::jsonb,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.video_assets (
  id text primary key,
  video_id text not null references public.videos(id) on delete cascade,
  subject_id text,
  kind text not null,
  media_type text not null,
  source_url text,
  content_sha256 text,
  rights_status text not null default 'unverified',
  approval_status text not null default 'pending',
  provenance jsonb not null default '{}'::jsonb,
  storage jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (content_sha256 is null or content_sha256 ~ '^[a-f0-9]{64}$')
);

create table public.video_publications (
  id text primary key,
  video_id text not null references public.videos(id) on delete cascade,
  platform text not null,
  account_key text not null default '',
  status text not null default 'planned',
  visibility text not null default 'private',
  title text not null default '',
  description text not null default '',
  hashtags jsonb not null default '[]'::jsonb,
  disclosure text not null default '',
  preview_url text,
  public_url text,
  external_id text,
  scheduled_for timestamptz,
  uploaded_at timestamptz,
  published_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (platform, account_key, external_id)
);

create table public.video_analytics (
  id uuid primary key default gen_random_uuid(),
  publication_id text not null references public.video_publications(id) on delete cascade,
  captured_at timestamptz not null,
  metrics jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  unique (publication_id, captured_at)
);

create index video_channels_niche_status_idx
  on public.video_channels (niche, status);
create index videos_channel_status_idx
  on public.videos (channel_id, status, created_at desc);
create index videos_niche_status_idx
  on public.videos (niche, status, created_at desc);
create index video_assets_video_kind_idx
  on public.video_assets (video_id, kind);
create index video_assets_rights_approval_idx
  on public.video_assets (rights_status, approval_status);
create index video_assets_sha256_idx
  on public.video_assets (content_sha256);
create index video_publications_video_status_idx
  on public.video_publications (video_id, status);
create index video_publications_schedule_idx
  on public.video_publications (scheduled_for)
  where status = 'scheduled';
create index video_analytics_publication_captured_idx
  on public.video_analytics (publication_id, captured_at desc);

drop trigger if exists set_video_channels_updated_at on public.video_channels;
create trigger set_video_channels_updated_at
before update on public.video_channels
for each row execute function public.set_video_updated_at();

drop trigger if exists set_videos_updated_at on public.videos;
create trigger set_videos_updated_at
before update on public.videos
for each row execute function public.set_video_updated_at();

drop trigger if exists set_video_assets_updated_at on public.video_assets;
create trigger set_video_assets_updated_at
before update on public.video_assets
for each row execute function public.set_video_updated_at();

drop trigger if exists set_video_publications_updated_at on public.video_publications;
create trigger set_video_publications_updated_at
before update on public.video_publications
for each row execute function public.set_video_updated_at();

alter table public.video_channels enable row level security;
alter table public.videos enable row level security;
alter table public.video_assets enable row level security;
alter table public.video_publications enable row level security;
alter table public.video_analytics enable row level security;

revoke all on public.video_channels from anon, authenticated;
revoke all on public.videos from anon, authenticated;
revoke all on public.video_assets from anon, authenticated;
revoke all on public.video_publications from anon, authenticated;
revoke all on public.video_analytics from anon, authenticated;

grant all on public.video_channels to postgres, service_role;
grant all on public.videos to postgres, service_role;
grant all on public.video_assets to postgres, service_role;
grant all on public.video_publications to postgres, service_role;
grant all on public.video_analytics to postgres, service_role;

commit;
