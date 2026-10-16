create extension if not exists pgcrypto;

create table if not exists public.digital_asset_distribution_reviews (
  id uuid primary key default gen_random_uuid(),
  product_id text not null,
  release_id text not null,
  manifest_hash text not null check (manifest_hash ~ '^[a-f0-9]{64}$'),
  listing_hash text not null check (listing_hash ~ '^[a-f0-9]{64}$'),
  marketplace text not null check (marketplace in ('itch.io')),
  decision text not null check (decision in ('approve_publish', 'keep_draft')),
  reviewer_discord_id text not null,
  reason text not null default '',
  decided_at timestamptz not null,
  discord_message_id text not null,
  discord_interaction_id text not null unique,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists digital_asset_distribution_reviews_release_idx
  on public.digital_asset_distribution_reviews (release_id, marketplace, decided_at desc);

create index if not exists digital_asset_distribution_reviews_manifest_idx
  on public.digital_asset_distribution_reviews (manifest_hash, listing_hash, marketplace, decided_at desc);

alter table public.digital_asset_distribution_reviews enable row level security;
revoke all on public.digital_asset_distribution_reviews from anon, authenticated, service_role;
grant all on public.digital_asset_distribution_reviews to postgres;
grant select, insert on public.digital_asset_distribution_reviews to service_role;
