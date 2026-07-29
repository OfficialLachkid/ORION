create extension if not exists pgcrypto;

create or replace function public.set_pokemon_species_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.pokemon_species (
  id text primary key,
  national_dex_number integer not null unique check (national_dex_number > 0),
  slug text not null unique,
  name text not null,
  generation integer not null check (generation between 1 and 20),
  region text not null default '',
  types jsonb not null default '[]'::jsonb,
  sprite_path text,
  silhouette_path text,
  shiny_sprite_path text,
  cry_path text,
  sprite_source_url text,
  silhouette_source_url text,
  shiny_sprite_source_url text,
  cry_source_url text,
  asset_status text not null default 'planned',
  metadata jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (
    jsonb_typeof(types) = 'array'
    and jsonb_array_length(types) between 1 and 2
  )
);

create index if not exists pokemon_species_generation_dex_idx
  on public.pokemon_species (generation, national_dex_number);

create index if not exists pokemon_species_asset_status_idx
  on public.pokemon_species (asset_status);

create index if not exists pokemon_species_types_gin_idx
  on public.pokemon_species
  using gin (types jsonb_path_ops);

drop trigger if exists set_pokemon_species_updated_at on public.pokemon_species;
create trigger set_pokemon_species_updated_at
before update on public.pokemon_species
for each row execute function public.set_pokemon_species_updated_at();

alter table public.pokemon_species enable row level security;
revoke all on public.pokemon_species from anon, authenticated;
grant all on public.pokemon_species to postgres, service_role;
