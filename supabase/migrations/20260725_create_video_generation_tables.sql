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

create table if not exists public.video_channels (
  id text primary key,
  name text not null,
  niche text not null,
  content_lane text not null,
  default_platform text not null,
  account_key text not null,
  language text not null default 'en-US',
  status text not null default 'active',
  strategy jsonb not null default '{}'::jsonb,
  style_profile jsonb not null default '{}'::jsonb,
  publication_slots jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (default_platform, account_key)
);

create table if not exists public.video_subjects (
  id text primary key,
  subject_type text not null,
  canonical_name text not null,
  description text not null default '',
  source_provider text not null,
  source_identifier text not null,
  source_url text,
  tags jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  imported_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (subject_type, source_provider, source_identifier)
);

create table if not exists public.video_products (
  subject_id text primary key references public.video_subjects(id) on delete cascade,
  brand text not null default '',
  category text not null default '',
  specifications jsonb not null default '{}'::jsonb,
  current_price_amount numeric(14, 2),
  current_price_currency text,
  list_price_amount numeric(14, 2),
  list_price_currency text,
  rating numeric(3, 2) check (rating is null or rating between 0 and 5),
  review_count integer not null default 0 check (review_count >= 0),
  affiliate_eligible boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.video_generations (
  id text primary key,
  channel_id text references public.video_channels(id) on delete restrict,
  schema_version text not null,
  mode text not null,
  content_lane text not null,
  template_key text not null,
  adapter text not null,
  status text not null default 'planned',
  source_device text not null default '',
  currency text not null default 'USD',
  estimated_cost numeric(14, 4) not null default 0 check (estimated_cost >= 0),
  incurred_cost numeric(14, 4) not null default 0 check (incurred_cost >= 0),
  config jsonb not null default '{}'::jsonb,
  manifest jsonb not null default '{}'::jsonb,
  notes jsonb not null default '[]'::jsonb,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.video_generation_subjects (
  generation_id text not null references public.video_generations(id) on delete cascade,
  subject_id text not null references public.video_subjects(id) on delete restrict,
  sequence_index integer not null default 0 check (sequence_index >= 0),
  role text not null default 'featured',
  created_at timestamptz not null default timezone('utc', now()),
  primary key (generation_id, subject_id),
  unique (generation_id, sequence_index)
);

create table if not exists public.video_source_snapshots (
  id text primary key,
  generation_id text references public.video_generations(id) on delete set null,
  subject_id text not null references public.video_subjects(id) on delete cascade,
  provider text not null,
  source_url text not null,
  retrieved_at timestamptz not null,
  retrieval_method text not null,
  source_access_permitted boolean not null default false,
  content_sha256 text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  check (content_sha256 is null or content_sha256 ~ '^[a-f0-9]{64}$')
);

create table if not exists public.video_subject_scores (
  id text primary key,
  generation_id text references public.video_generations(id) on delete set null,
  subject_id text not null references public.video_subjects(id) on delete cascade,
  scoring_version text not null,
  dimensions jsonb not null default '{}'::jsonb,
  weights jsonb not null default '{}'::jsonb,
  overall_score numeric(5, 2) not null check (overall_score between 0 and 100),
  expected_value jsonb not null default '{}'::jsonb,
  scored_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.video_assets (
  id text primary key,
  generation_id text references public.video_generations(id) on delete set null,
  subject_id text references public.video_subjects(id) on delete set null,
  parent_asset_id text references public.video_assets(id) on delete set null,
  asset_kind text not null,
  media_type text not null,
  source_provider text not null,
  source_url text,
  source_page_url text,
  retrieved_at timestamptz,
  retrieval_method text not null,
  content_sha256 text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  mime_type text,
  duration_seconds numeric(12, 3) check (duration_seconds is null or duration_seconds >= 0),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  rights_status text not null default 'unverified',
  rights_basis text not null default 'unknown',
  rights_evidence text,
  attribution_required boolean not null default false,
  attribution_text text,
  approval_status text not null default 'pending',
  usage_scope text not null default 'publication',
  usage_notes jsonb not null default '[]'::jsonb,
  lifecycle_status text not null default 'referenced',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (content_sha256 is null or content_sha256 ~ '^[a-f0-9]{64}$'),
  check (not attribution_required or attribution_text is not null)
);

create table if not exists public.video_media_locations (
  id uuid primary key default gen_random_uuid(),
  asset_id text not null references public.video_assets(id) on delete cascade,
  location_type text not null,
  device_id text not null default '',
  uri text not null,
  status text not null default 'available',
  content_sha256 text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  last_verified_at timestamptz,
  archived_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (asset_id, location_type, device_id, uri),
  check (content_sha256 is null or content_sha256 ~ '^[a-f0-9]{64}$')
);

create table if not exists public.video_script_jobs (
  id text primary key,
  generation_id text not null references public.video_generations(id) on delete cascade,
  primary_subject_id text references public.video_subjects(id) on delete set null,
  angle text not null,
  target_duration_seconds integer not null check (target_duration_seconds between 10 and 600),
  prompt_version text not null,
  creative_brief jsonb not null default '{}'::jsonb,
  model_plan jsonb not null default '{}'::jsonb,
  status text not null default 'planned',
  estimated_cost numeric(14, 4) not null default 0 check (estimated_cost >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.video_script_variants (
  id text primary key,
  generation_id text not null references public.video_generations(id) on delete cascade,
  primary_subject_id text references public.video_subjects(id) on delete set null,
  script_job_id text not null references public.video_script_jobs(id) on delete restrict,
  parent_variant_id text references public.video_script_variants(id) on delete set null,
  angle text not null,
  target_duration_seconds integer not null check (target_duration_seconds between 10 and 600),
  hook text not null,
  body text not null,
  closing_line text not null,
  spoken_text text not null,
  disclosure text not null default '',
  generation_provider text not null,
  model text not null,
  prompt_version text not null default '',
  revision_number integer not null default 1 check (revision_number >= 1),
  revision_reason text not null default '',
  status text not null default 'awaiting_approval',
  approval_status text not null default 'pending',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.video_script_revisions (
  id text primary key,
  script_variant_id text not null references public.video_script_variants(id) on delete cascade,
  previous_spoken_text text not null,
  revised_spoken_text text not null,
  revised_by text not null,
  reason text not null,
  revised_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.video_voice_jobs (
  id text primary key,
  generation_id text not null references public.video_generations(id) on delete cascade,
  script_job_id text not null references public.video_script_jobs(id) on delete restrict,
  script_variant_id text references public.video_script_variants(id) on delete restrict,
  output_asset_id text references public.video_assets(id) on delete set null,
  provider text not null,
  profile_id text not null,
  model text not null,
  voice text not null,
  language text not null,
  synthesis_settings jsonb not null default '{}'::jsonb,
  status text not null default 'planned',
  blockers jsonb not null default '[]'::jsonb,
  duration_seconds numeric(12, 3) check (duration_seconds is null or duration_seconds >= 0),
  estimated_cost numeric(14, 4) not null default 0 check (estimated_cost >= 0),
  execution_plan jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.video_caption_jobs (
  id text primary key,
  generation_id text not null references public.video_generations(id) on delete cascade,
  script_job_id text not null references public.video_script_jobs(id) on delete restrict,
  voice_job_id text not null references public.video_voice_jobs(id) on delete restrict,
  words_asset_id text references public.video_assets(id) on delete set null,
  captions_asset_id text references public.video_assets(id) on delete set null,
  provider text not null,
  model text not null,
  language text not null,
  timing_mode text not null,
  max_words_per_line integer not null default 4 check (max_words_per_line between 1 and 8),
  words jsonb not null default '[]'::jsonb,
  duration_seconds numeric(12, 3) not null default 0 check (duration_seconds >= 0),
  status text not null default 'planned',
  blockers jsonb not null default '[]'::jsonb,
  execution_plan jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.video_render_jobs (
  id text primary key,
  generation_id text not null references public.video_generations(id) on delete cascade,
  script_job_id text not null references public.video_script_jobs(id) on delete restrict,
  script_variant_id text references public.video_script_variants(id) on delete restrict,
  voice_job_id text not null references public.video_voice_jobs(id) on delete restrict,
  caption_job_id text not null references public.video_caption_jobs(id) on delete restrict,
  output_asset_id text references public.video_assets(id) on delete set null,
  renderer text not null,
  render_purpose text not null,
  publication_eligible boolean not null default false,
  watermark_required boolean not null default false,
  template_id text not null,
  aspect_ratio text not null default '9:16',
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  fps integer not null check (fps between 1 and 120),
  platform_targets jsonb not null default '[]'::jsonb,
  status text not null default 'planned',
  blockers jsonb not null default '[]'::jsonb,
  estimated_cost numeric(14, 4) not null default 0 check (estimated_cost >= 0),
  execution_plan jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.video_render_clips (
  id text primary key,
  render_job_id text not null references public.video_render_jobs(id) on delete cascade,
  asset_id text not null references public.video_assets(id) on delete restrict,
  sequence_index integer not null check (sequence_index >= 0),
  role text not null,
  media_type text not null,
  source_start_seconds numeric(12, 3) not null default 0 check (source_start_seconds >= 0),
  duration_seconds numeric(12, 3) not null check (duration_seconds > 0),
  fit text not null default 'cover',
  crop_settings jsonb not null default '{}'::jsonb,
  transition_after text not null default 'cut',
  transition_duration_seconds numeric(6, 3) not null default 0
    check (transition_duration_seconds >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (render_job_id, sequence_index),
  check (
    (transition_after = 'cut' and transition_duration_seconds = 0)
    or (transition_after <> 'cut' and transition_duration_seconds > 0)
  )
);

create table if not exists public.video_approvals (
  id text primary key,
  generation_id text not null references public.video_generations(id) on delete cascade,
  stage text not null,
  action text not null,
  subject_type text not null,
  subject_id text not null,
  task_id text not null unique,
  state text not null default 'pending',
  blocking_reasons jsonb not null default '[]'::jsonb,
  requested_at timestamptz not null,
  requested_by text not null,
  decided_at timestamptz,
  decided_by text,
  decision_reason text not null default '',
  discord_channel_id text,
  discord_message_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.video_affiliate_links (
  id text primary key,
  subject_id text not null references public.video_products(subject_id) on delete cascade,
  provider text not null,
  destination_url text not null,
  tracking_url text,
  disclosure text not null,
  status text not null default 'pending',
  approval_status text not null default 'pending',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.video_publications (
  id text primary key,
  generation_id text not null references public.video_generations(id) on delete cascade,
  channel_id text not null references public.video_channels(id) on delete restrict,
  render_job_id text not null references public.video_render_jobs(id) on delete restrict,
  platform text not null,
  account_key text not null,
  external_id text,
  title text not null,
  description text not null default '',
  hashtags jsonb not null default '[]'::jsonb,
  disclosure text not null default '',
  visibility text not null default 'private',
  status text not null default 'planned',
  preview_url text,
  public_url text,
  scheduled_for timestamptz,
  uploaded_at timestamptz,
  published_at timestamptz,
  rejected_at timestamptz,
  deleted_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (platform, account_key, external_id)
);

create table if not exists public.video_publication_affiliate_links (
  publication_id text not null references public.video_publications(id) on delete cascade,
  affiliate_link_id text not null references public.video_affiliate_links(id) on delete restrict,
  sequence_index integer not null default 0 check (sequence_index >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (publication_id, affiliate_link_id),
  unique (publication_id, sequence_index)
);

create table if not exists public.video_analytics_snapshots (
  id text primary key,
  publication_id text not null references public.video_publications(id) on delete cascade,
  platform text not null,
  captured_at timestamptz not null,
  views bigint not null default 0 check (views >= 0),
  likes bigint not null default 0 check (likes >= 0),
  comments bigint not null default 0 check (comments >= 0),
  shares bigint not null default 0 check (shares >= 0),
  watch_time_seconds numeric(18, 3) not null default 0 check (watch_time_seconds >= 0),
  average_view_duration_seconds numeric(12, 3) not null default 0
    check (average_view_duration_seconds >= 0),
  average_percentage_viewed numeric(7, 4)
    check (average_percentage_viewed is null or average_percentage_viewed between 0 and 100),
  clicks bigint not null default 0 check (clicks >= 0),
  conversions bigint not null default 0 check (conversions >= 0),
  revenue numeric(14, 4) not null default 0,
  currency text not null default 'USD',
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  unique (publication_id, captured_at)
);

create index if not exists video_channels_lane_status_idx
  on public.video_channels (content_lane, status);
create index if not exists video_subjects_type_status_idx
  on public.video_subjects (subject_type, status);
create index if not exists video_products_category_idx
  on public.video_products (category);
create index if not exists video_generations_channel_status_idx
  on public.video_generations (channel_id, status, created_at desc);
create index if not exists video_generation_subjects_subject_idx
  on public.video_generation_subjects (subject_id, generation_id);
create index if not exists video_source_snapshots_subject_retrieved_idx
  on public.video_source_snapshots (subject_id, retrieved_at desc);
create index if not exists video_subject_scores_subject_scored_idx
  on public.video_subject_scores (subject_id, scored_at desc);
create index if not exists video_assets_subject_kind_idx
  on public.video_assets (subject_id, asset_kind);
create index if not exists video_assets_sha256_idx
  on public.video_assets (content_sha256);
create index if not exists video_assets_rights_approval_idx
  on public.video_assets (rights_status, approval_status);
create index if not exists video_media_locations_asset_status_idx
  on public.video_media_locations (asset_id, status);
create index if not exists video_script_jobs_generation_status_idx
  on public.video_script_jobs (generation_id, status);
create index if not exists video_script_variants_generation_status_idx
  on public.video_script_variants (generation_id, status);
create index if not exists video_script_revisions_variant_revised_idx
  on public.video_script_revisions (script_variant_id, revised_at desc);
create index if not exists video_voice_jobs_generation_status_idx
  on public.video_voice_jobs (generation_id, status);
create index if not exists video_caption_jobs_generation_status_idx
  on public.video_caption_jobs (generation_id, status);
create index if not exists video_render_jobs_generation_status_idx
  on public.video_render_jobs (generation_id, status);
create index if not exists video_render_clips_render_sequence_idx
  on public.video_render_clips (render_job_id, sequence_index);
create index if not exists video_approvals_state_requested_idx
  on public.video_approvals (state, requested_at);
create index if not exists video_approvals_subject_idx
  on public.video_approvals (subject_type, subject_id);
create index if not exists video_publications_platform_status_idx
  on public.video_publications (platform, status);
create index if not exists video_publications_schedule_idx
  on public.video_publications (scheduled_for)
  where status = 'scheduled';
create index if not exists video_analytics_publication_captured_idx
  on public.video_analytics_snapshots (publication_id, captured_at desc);

do $$
declare
  table_name text;
  trigger_name text;
begin
  foreach table_name in array array[
    'video_channels',
    'video_subjects',
    'video_products',
    'video_generations',
    'video_assets',
    'video_media_locations',
    'video_script_jobs',
    'video_script_variants',
    'video_voice_jobs',
    'video_caption_jobs',
    'video_render_jobs',
    'video_render_clips',
    'video_approvals',
    'video_affiliate_links',
    'video_publications'
  ]
  loop
    trigger_name := format('set_%s_updated_at', table_name);
    execute format('drop trigger if exists %I on public.%I', trigger_name, table_name);
    execute format(
      'create trigger %I before update on public.%I '
      'for each row execute function public.set_video_updated_at()',
      trigger_name,
      table_name
    );
  end loop;
end;
$$;

do $$
declare
  table_name text;
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
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
    execute format('grant all on table public.%I to postgres, service_role', table_name);
  end loop;
end;
$$;

create or replace view public.video_generation_overview
with (security_invoker = true)
as
select
  generation.id,
  generation.channel_id,
  channel.name as channel_name,
  generation.content_lane,
  generation.template_key,
  generation.status,
  count(distinct subject.subject_id) as subject_count,
  count(distinct script.id) as script_variant_count,
  count(distinct publication.id) as publication_count,
  count(distinct publication.id)
    filter (where publication.status = 'published') as published_count,
  max(publication.published_at) as last_published_at,
  max(publication.updated_at) as last_publication_activity_at
from public.video_generations generation
left join public.video_channels channel
  on channel.id = generation.channel_id
left join public.video_generation_subjects subject
  on subject.generation_id = generation.id
left join public.video_script_variants script
  on script.generation_id = generation.id
left join public.video_publications publication
  on publication.generation_id = generation.id
group by generation.id, channel.name;

revoke all on public.video_generation_overview from anon, authenticated;
grant select on public.video_generation_overview to postgres, service_role;
