create extension if not exists pgcrypto;

create table if not exists public.digital_asset_review_decisions (
  id uuid primary key default gen_random_uuid(),
  product_id text not null,
  release_id text not null,
  manifest_hash text not null check (manifest_hash ~ '^[a-f0-9]{64}$'),
  asset_id text not null,
  asset_hash text not null check (asset_hash ~ '^[a-f0-9]{64}$'),
  decision text not null check (decision in ('approve', 'request_changes', 'reject')),
  reviewer_discord_id text not null,
  reason text not null default '',
  decided_at timestamptz not null,
  discord_message_id text not null,
  discord_interaction_id text not null unique,
  created_at timestamptz not null default timezone('utc', now()),
  check (decision = 'approve' or length(trim(reason)) >= 3)
);

create index if not exists digital_asset_review_decisions_release_asset_idx
  on public.digital_asset_review_decisions (release_id, asset_id, decided_at desc);

create index if not exists digital_asset_review_decisions_manifest_idx
  on public.digital_asset_review_decisions (manifest_hash, decided_at desc);

alter table public.digital_asset_review_decisions enable row level security;
revoke all on public.digital_asset_review_decisions from anon, authenticated, service_role;
grant all on public.digital_asset_review_decisions to postgres;
grant select, insert on public.digital_asset_review_decisions to service_role;
