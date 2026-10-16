create extension if not exists pgcrypto;

create table if not exists public.digital_asset_research_runs (
  run_id uuid primary key,
  source_id text not null,
  status text not null check (status in ('running', 'completed', 'failed')),
  started_at timestamptz not null,
  completed_at timestamptz,
  raw_archive_path text not null,
  observation_count integer not null default 0 check (observation_count >= 0),
  error text not null default '',
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.digital_asset_research_observations (
  observation_id uuid primary key,
  run_id uuid not null references public.digital_asset_research_runs(run_id) on delete restrict,
  source_id text not null,
  view_id text not null,
  signal text not null check (signal in ('supply_activity', 'marketplace_rank_proxy')),
  observed_at timestamptz not null,
  rank integer not null check (rank > 0),
  listing_url text not null,
  title text not null,
  creator text not null default '',
  price_text text not null default '',
  summary text not null default '',
  tags jsonb not null default '[]'::jsonb,
  evidence_hash text not null check (evidence_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default timezone('utc', now()),
  unique (run_id, view_id, listing_url)
);

create table if not exists public.digital_asset_research_opportunities (
  recommendation_id text primary key,
  source_id text not null,
  evidence_hash text not null check (evidence_hash ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('awaiting_review', 'approved_handoff', 'monitor', 'reject')),
  recommendation jsonb not null,
  evidence_observation_ids jsonb not null,
  discord_channel_id text,
  discord_message_id text,
  created_at timestamptz not null,
  decided_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.digital_asset_research_reviews (
  id uuid primary key default gen_random_uuid(),
  recommendation_id text not null references public.digital_asset_research_opportunities(recommendation_id) on delete restrict,
  evidence_hash text not null check (evidence_hash ~ '^[a-f0-9]{64}$'),
  decision text not null check (decision in ('approve_handoff', 'monitor', 'reject')),
  reviewer_discord_id text not null,
  reason text not null default '',
  decided_at timestamptz not null,
  discord_message_id text not null,
  discord_interaction_id text not null unique,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists digital_asset_research_runs_source_idx
  on public.digital_asset_research_runs (source_id, started_at desc);
create index if not exists digital_asset_research_observations_source_idx
  on public.digital_asset_research_observations (source_id, observed_at desc, view_id, rank);
create index if not exists digital_asset_research_reviews_recommendation_idx
  on public.digital_asset_research_reviews (recommendation_id, decided_at desc);

alter table public.digital_asset_research_runs enable row level security;
alter table public.digital_asset_research_observations enable row level security;
alter table public.digital_asset_research_opportunities enable row level security;
alter table public.digital_asset_research_reviews enable row level security;

revoke all on public.digital_asset_research_runs from anon, authenticated, service_role;
revoke all on public.digital_asset_research_observations from anon, authenticated, service_role;
revoke all on public.digital_asset_research_opportunities from anon, authenticated, service_role;
revoke all on public.digital_asset_research_reviews from anon, authenticated, service_role;
grant all on public.digital_asset_research_runs to postgres;
grant all on public.digital_asset_research_observations to postgres;
grant all on public.digital_asset_research_opportunities to postgres;
grant all on public.digital_asset_research_reviews to postgres;
grant select, insert, update on public.digital_asset_research_runs to service_role;
grant select, insert on public.digital_asset_research_observations to service_role;
grant select, insert, update on public.digital_asset_research_opportunities to service_role;
grant select, insert on public.digital_asset_research_reviews to service_role;
