create extension if not exists pgcrypto;

create or replace function public.set_orion_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.website_designs (
  id text primary key,
  title text not null,
  summary text not null default '',
  template_id text not null,
  draft jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists website_designs_template_id_idx
  on public.website_designs (template_id);

create index if not exists website_designs_updated_at_idx
  on public.website_designs (updated_at desc);

drop trigger if exists set_website_designs_updated_at on public.website_designs;
create trigger set_website_designs_updated_at
before update on public.website_designs
for each row
execute function public.set_orion_updated_at();

alter table public.website_designs enable row level security;
revoke all on public.website_designs from anon, authenticated;
grant all on public.website_designs to postgres, service_role;

create table if not exists public.websites (
  id text primary key,
  title text not null,
  company_name text not null default '',
  summary text not null default '',
  template_id text not null,
  source_design_id text references public.website_designs (id) on delete set null,
  draft jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists websites_template_id_idx
  on public.websites (template_id);

create index if not exists websites_source_design_id_idx
  on public.websites (source_design_id);

create index if not exists websites_updated_at_idx
  on public.websites (updated_at desc);

drop trigger if exists set_websites_updated_at on public.websites;
create trigger set_websites_updated_at
before update on public.websites
for each row
execute function public.set_orion_updated_at();

alter table public.websites enable row level security;
revoke all on public.websites from anon, authenticated;
grant all on public.websites to postgres, service_role;
