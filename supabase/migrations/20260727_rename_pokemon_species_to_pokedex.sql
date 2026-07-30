do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'pokemon_species'
  ) and not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'pokedex'
  ) then
    alter table public.pokemon_species rename to pokedex;
  end if;
end
$$;

alter index if exists public.pokemon_species_generation_dex_idx
  rename to pokedex_generation_dex_idx;

alter index if exists public.pokemon_species_asset_status_idx
  rename to pokedex_asset_status_idx;

alter index if exists public.pokemon_species_types_gin_idx
  rename to pokedex_types_gin_idx;

drop trigger if exists set_pokemon_species_updated_at on public.pokedex;
drop trigger if exists set_pokedex_updated_at on public.pokedex;

create or replace function public.set_pokedex_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create trigger set_pokedex_updated_at
before update on public.pokedex
for each row execute function public.set_pokedex_updated_at();

drop function if exists public.set_pokemon_species_updated_at();

alter table public.pokedex enable row level security;
revoke all on public.pokedex from anon, authenticated;
grant all on public.pokedex to postgres, service_role;
