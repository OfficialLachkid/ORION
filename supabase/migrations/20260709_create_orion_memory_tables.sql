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

create table if not exists public.orion_memory_records (
  id uuid primary key default gen_random_uuid(),
  record_key text not null unique,
  source_kind text not null,
  memory_namespace text not null,
  topic text not null,
  title text not null,
  summary text not null default '',
  content_markdown text not null,
  source_path text not null,
  source_sha256 text not null,
  source_device text not null,
  review_status text not null default 'active',
  version integer not null default 1 check (version >= 1),
  conflict_flag boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists orion_memory_records_namespace_topic_idx
  on public.orion_memory_records (memory_namespace, topic);

create index if not exists orion_memory_records_source_kind_idx
  on public.orion_memory_records (source_kind);

drop trigger if exists set_orion_memory_records_updated_at on public.orion_memory_records;
create trigger set_orion_memory_records_updated_at
before update on public.orion_memory_records
for each row
execute function public.set_orion_updated_at();

alter table public.orion_memory_records enable row level security;
revoke all on public.orion_memory_records from anon, authenticated;
grant all on public.orion_memory_records to postgres, service_role;

create table if not exists public.orion_memory_sync_runs (
  id uuid primary key default gen_random_uuid(),
  sync_name text not null,
  source_kind text not null,
  source_device text not null,
  status text not null,
  records_scanned integer not null default 0,
  inserted_count integer not null default 0,
  updated_count integer not null default 0,
  unchanged_count integer not null default 0,
  export_path text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists orion_memory_sync_runs_sync_name_idx
  on public.orion_memory_sync_runs (sync_name, created_at desc);

drop trigger if exists set_orion_memory_sync_runs_updated_at on public.orion_memory_sync_runs;
create trigger set_orion_memory_sync_runs_updated_at
before update on public.orion_memory_sync_runs
for each row
execute function public.set_orion_updated_at();

alter table public.orion_memory_sync_runs enable row level security;
revoke all on public.orion_memory_sync_runs from anon, authenticated;
grant all on public.orion_memory_sync_runs to postgres, service_role;
