create extension if not exists pgcrypto;

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  source_url text not null unique,
  business_name text not null default '',
  business_type text not null default '',
  services jsonb not null default '[]'::jsonb,
  contact_email text,
  contact_phone text,
  social_links jsonb not null default '[]'::jsonb,
  website_quality text,
  search_query text not null default '',
  niche text not null default '',
  location text not null default '',
  status text not null default 'new',
  raw_extraction jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists leads_niche_idx on public.leads (niche);
create index if not exists leads_status_idx on public.leads (status);
create index if not exists leads_created_at_idx on public.leads (created_at desc);

drop trigger if exists set_leads_updated_at on public.leads;
create trigger set_leads_updated_at
before update on public.leads
for each row
execute function public.set_orion_updated_at();

alter table public.leads enable row level security;
revoke all on public.leads from anon, authenticated;
grant all on public.leads to postgres, service_role;
