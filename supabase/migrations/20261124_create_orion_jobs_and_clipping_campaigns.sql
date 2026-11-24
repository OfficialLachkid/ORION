begin;

create extension if not exists pgcrypto;

create table if not exists public.orion_jobs (
  id uuid primary key default gen_random_uuid(),
  namespace text not null,
  job_type text not null,
  subject_id text not null,
  idempotency_key text not null,
  input_revision text not null,
  status text not null default 'queued'
    check (status in (
      'queued', 'running', 'waiting_for_resources', 'awaiting_review',
      'retry', 'completed', 'review', 'failed', 'cancelled'
    )),
  priority smallint not null default 0,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  worker_id text,
  claim_token uuid,
  claimed_at timestamptz,
  heartbeat_at timestamptz,
  lease_expires_at timestamptz,
  next_retry_at timestamptz,
  progress jsonb not null default '{}'::jsonb,
  input_ref jsonb not null default '{}'::jsonb,
  output_ref jsonb not null default '{}'::jsonb,
  receipt jsonb not null default '{}'::jsonb,
  last_error text not null default '',
  discord_channel_id text,
  discord_message_id text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  unique (namespace, idempotency_key),
  check (jsonb_typeof(progress) = 'object'),
  check (jsonb_typeof(input_ref) = 'object'),
  check (jsonb_typeof(output_ref) = 'object'),
  check (jsonb_typeof(receipt) = 'object')
);

create table if not exists public.clipping_campaigns (
  id uuid primary key default gen_random_uuid(),
  marketplace_key text not null,
  external_campaign_id text not null,
  search_profile_key text not null,
  source_url text not null,
  revision_hash text not null,
  status text not null default 'imported'
    check (status in ('imported', 'qualified', 'rejected', 'accepted', 'expired')),
  rights_status text not null default 'unknown'
    check (rights_status in ('unknown', 'review_required', 'accepted', 'rejected', 'expired')),
  terms_summary jsonb not null default '{}'::jsonb,
  evidence_manifest_path text,
  source_updated_at timestamptz,
  deadline_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (marketplace_key, external_campaign_id, revision_hash),
  check (jsonb_typeof(terms_summary) = 'object')
);

create index if not exists orion_jobs_due_idx
  on public.orion_jobs (namespace, status, priority desc, next_retry_at, created_at)
  where status in ('queued', 'retry', 'waiting_for_resources');

create index if not exists orion_jobs_stale_lease_idx
  on public.orion_jobs (namespace, lease_expires_at)
  where status = 'running';

create index if not exists clipping_campaigns_active_idx
  on public.clipping_campaigns (search_profile_key, status, deadline_at)
  where status in ('imported', 'qualified', 'accepted');

create or replace function public.set_orion_job_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_orion_jobs_updated_at on public.orion_jobs;
create trigger set_orion_jobs_updated_at
before update on public.orion_jobs
for each row execute function public.set_orion_job_updated_at();

drop trigger if exists set_clipping_campaigns_updated_at on public.clipping_campaigns;
create trigger set_clipping_campaigns_updated_at
before update on public.clipping_campaigns
for each row execute function public.set_orion_job_updated_at();

create or replace function public.claim_orion_jobs(
  p_namespace text,
  p_worker_id text,
  p_limit integer default 1,
  p_lease_seconds integer default 900
)
returns setof public.orion_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_namespace is null or btrim(p_namespace) = '' then
    raise exception 'namespace is required';
  end if;
  if p_worker_id is null or btrim(p_worker_id) = '' then
    raise exception 'worker id is required';
  end if;
  if p_limit < 1 or p_limit > 25 then
    raise exception 'claim limit must be between 1 and 25';
  end if;
  if p_lease_seconds < 30 or p_lease_seconds > 14400 then
    raise exception 'lease must be between 30 and 14400 seconds';
  end if;

  return query
  with candidates as (
    select id
    from public.orion_jobs
    where namespace = p_namespace
      and status in ('queued', 'retry', 'waiting_for_resources')
      and attempt_count < max_attempts
      and (next_retry_at is null or next_retry_at <= timezone('utc', now()))
    order by priority desc, created_at asc
    for update skip locked
    limit p_limit
  )
  update public.orion_jobs as job
  set status = 'running',
      attempt_count = job.attempt_count + 1,
      worker_id = p_worker_id,
      claim_token = gen_random_uuid(),
      claimed_at = timezone('utc', now()),
      heartbeat_at = timezone('utc', now()),
      lease_expires_at = timezone('utc', now()) + make_interval(secs => p_lease_seconds),
      next_retry_at = null,
      last_error = ''
  from candidates
  where job.id = candidates.id
  returning job.*;
end;
$$;

create or replace function public.heartbeat_orion_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_lease_seconds integer default 900
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  if p_lease_seconds < 30 or p_lease_seconds > 14400 then
    raise exception 'lease must be between 30 and 14400 seconds';
  end if;
  update public.orion_jobs
  set heartbeat_at = timezone('utc', now()),
      lease_expires_at = timezone('utc', now()) + make_interval(secs => p_lease_seconds)
  where id = p_job_id
    and status = 'running'
    and claim_token = p_claim_token
    and lease_expires_at > timezone('utc', now());
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

create or replace function public.recover_stale_orion_jobs(
  p_namespace text,
  p_limit integer default 25,
  p_retry_delay_seconds integer default 60
)
returns setof public.orion_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_namespace is null or btrim(p_namespace) = '' then
    raise exception 'namespace is required';
  end if;
  if p_limit < 1 or p_limit > 100 then
    raise exception 'recovery limit must be between 1 and 100';
  end if;
  if p_retry_delay_seconds < 0 or p_retry_delay_seconds > 3600 then
    raise exception 'retry delay must be between 0 and 3600 seconds';
  end if;

  return query
  with stale as (
    select id
    from public.orion_jobs
    where namespace = p_namespace
      and status = 'running'
      and (lease_expires_at is null or lease_expires_at <= timezone('utc', now()))
    order by lease_expires_at nulls first, created_at asc
    for update skip locked
    limit p_limit
  )
  update public.orion_jobs as job
  set status = case when job.attempt_count >= job.max_attempts then 'review' else 'retry' end,
      worker_id = null,
      claim_token = null,
      claimed_at = null,
      heartbeat_at = null,
      lease_expires_at = null,
      next_retry_at = case
        when job.attempt_count >= job.max_attempts then null
        else timezone('utc', now()) + make_interval(secs => p_retry_delay_seconds)
      end,
      last_error = left(
        case when job.last_error = ''
          then 'Worker lease expired before completion.'
          else job.last_error || ' | Worker lease expired before completion.'
        end,
        1200
      )
  from stale
  where job.id = stale.id
  returning job.*;
end;
$$;

create or replace function public.complete_orion_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_output_ref jsonb default '{}'::jsonb,
  p_receipt jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  if jsonb_typeof(coalesce(p_output_ref, '{}'::jsonb)) <> 'object'
      or jsonb_typeof(coalesce(p_receipt, '{}'::jsonb)) <> 'object' then
    raise exception 'output reference and receipt must be JSON objects';
  end if;
  update public.orion_jobs
  set status = 'completed',
      output_ref = coalesce(p_output_ref, '{}'::jsonb),
      receipt = coalesce(p_receipt, '{}'::jsonb),
      worker_id = null,
      claim_token = null,
      claimed_at = null,
      heartbeat_at = null,
      lease_expires_at = null,
      next_retry_at = null,
      completed_at = timezone('utc', now()),
      last_error = ''
  where id = p_job_id
    and status = 'running'
    and claim_token = p_claim_token
    and lease_expires_at > timezone('utc', now());
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

alter table public.orion_jobs enable row level security;
alter table public.clipping_campaigns enable row level security;

revoke all on public.orion_jobs from anon, authenticated, service_role;
revoke all on public.clipping_campaigns from anon, authenticated, service_role;
grant all on public.orion_jobs to postgres;
grant all on public.clipping_campaigns to postgres;
grant select, insert, update on public.orion_jobs to service_role;
grant select, insert, update on public.clipping_campaigns to service_role;

revoke all on function public.claim_orion_jobs(text, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.heartbeat_orion_job(uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.recover_stale_orion_jobs(text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.complete_orion_job(uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.claim_orion_jobs(text, text, integer, integer)
  to postgres, service_role;
grant execute on function public.heartbeat_orion_job(uuid, uuid, integer)
  to postgres, service_role;
grant execute on function public.recover_stale_orion_jobs(text, integer, integer)
  to postgres, service_role;
grant execute on function public.complete_orion_job(uuid, uuid, jsonb, jsonb)
  to postgres, service_role;

commit;
