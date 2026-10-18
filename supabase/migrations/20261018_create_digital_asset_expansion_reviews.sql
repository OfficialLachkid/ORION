create extension if not exists pgcrypto;

create table if not exists public.digital_asset_expansion_reviews (
  id uuid primary key default gen_random_uuid(),
  product_id text not null,
  expansion_id text not null,
  base_release_id text not null,
  target_version text not null check (target_version ~ '^\d+\.\d+\.\d+$'),
  manifest_hash text not null check (manifest_hash ~ '^[a-f0-9]{64}$'),
  decision text not null check (decision in ('approve', 'request_changes', 'reject')),
  affected_asset_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(affected_asset_ids) = 'array'),
  asset_decisions jsonb not null default '[]'::jsonb check (jsonb_typeof(asset_decisions) = 'array'),
  reviewer_discord_id text not null,
  reason text not null default '',
  decided_at timestamptz not null,
  discord_message_id text not null,
  discord_interaction_id text not null unique,
  created_at timestamptz not null default timezone('utc', now()),
  check (decision = 'approve' or length(trim(reason)) >= 3)
);

create index if not exists digital_asset_expansion_reviews_expansion_idx
  on public.digital_asset_expansion_reviews (product_id, expansion_id, decided_at desc);

create index if not exists digital_asset_expansion_reviews_manifest_idx
  on public.digital_asset_expansion_reviews (manifest_hash, decided_at desc);

alter table public.digital_asset_expansion_reviews enable row level security;
revoke all on public.digital_asset_expansion_reviews from anon, authenticated, service_role;
grant all on public.digital_asset_expansion_reviews to postgres;
grant select, insert on public.digital_asset_expansion_reviews to service_role;

