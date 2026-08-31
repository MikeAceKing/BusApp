-- BusApp V2.1 — canonical profiles, private photos and user-targeted avatar refresh pulses.
-- Additive only. Existing initials avatar_key values remain the final fallback.

begin;

create table public.bus_app_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 50),
  language text not null default 'nl' check (language in ('nl','fr')),
  avatar_source text not null default 'BUILT_IN' check (avatar_source in ('BUILT_IN','UPLOAD')),
  avatar_builtin_id text check (avatar_builtin_id is null or avatar_builtin_id ~ '^adult-0[1-8]$'),
  avatar_asset_id uuid,
  avatar_version integer not null default 1 check (avatar_version > 0),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (avatar_source = 'BUILT_IN' and avatar_asset_id is null)
    or (avatar_source = 'UPLOAD' and avatar_builtin_id is null and avatar_asset_id is not null)
  )
);

create table public.bus_app_avatar_assets (
  id uuid primary key default gen_random_uuid(),
  bus_space_id uuid references public.bus_app_spaces(id) on delete cascade,
  profile_user_id uuid references auth.users(id) on delete cascade,
  passenger_id uuid references public.bus_app_passengers(id) on delete cascade,
  bus_id uuid references public.bus_app_buses(id) on delete cascade,
  storage_path text not null unique check (storage_path ~ '^(profiles/[0-9a-f-]+|spaces/[0-9a-f-]+/(passengers|buses)/[0-9a-f-]+)/[0-9a-f-]+\.webp$'),
  thumbnail_storage_path text not null unique check (thumbnail_storage_path ~ '^(profiles/[0-9a-f-]+|spaces/[0-9a-f-]+/(passengers|buses)/[0-9a-f-]+)/[0-9a-f-]+-thumb\.webp$'),
  mime_type text not null default 'image/webp' check (mime_type = 'image/webp'),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 5242880),
  thumbnail_size_bytes bigint not null check (thumbnail_size_bytes > 0 and thumbnail_size_bytes <= 1048576),
  width integer not null check (width between 1 and 1600),
  height integer not null check (height between 1 and 1200),
  thumbnail_width integer not null check (thumbnail_width between 1 and 320),
  thumbnail_height integer not null check (thumbnail_height between 1 and 320),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','REPLACED','DELETED')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  replaced_at timestamptz,
  deleted_at timestamptz,
  check (num_nonnulls(profile_user_id, passenger_id, bus_id) = 1),
  check (
    (profile_user_id is not null and bus_space_id is null)
    or (profile_user_id is null and bus_space_id is not null)
  )
);

create index bus_app_avatar_assets_space_idx
  on public.bus_app_avatar_assets(bus_space_id, status, created_at desc);
create index bus_app_avatar_assets_profile_idx
  on public.bus_app_avatar_assets(profile_user_id, status, created_at desc)
  where profile_user_id is not null;
create index bus_app_avatar_assets_passenger_idx
  on public.bus_app_avatar_assets(passenger_id, status, created_at desc)
  where passenger_id is not null;
create index bus_app_avatar_assets_bus_idx
  on public.bus_app_avatar_assets(bus_id, status, created_at desc)
  where bus_id is not null;

alter table public.bus_app_profiles
  add constraint bus_app_profiles_avatar_asset_fk
  foreign key (avatar_asset_id) references public.bus_app_avatar_assets(id) on delete restrict;

alter table public.bus_app_passengers
  add column avatar_source text not null default 'BUILT_IN',
  add column avatar_builtin_id text,
  add column avatar_asset_id uuid,
  add column avatar_version integer not null default 1,
  add column avatar_updated_at timestamptz not null default now(),
  add column avatar_updated_by uuid references auth.users(id) on delete set null;

alter table public.bus_app_passengers
  add constraint bus_app_passengers_avatar_source_check check (avatar_source in ('BUILT_IN','UPLOAD')),
  add constraint bus_app_passengers_avatar_builtin_check check (avatar_builtin_id is null or avatar_builtin_id ~ '^child-(0[1-9]|1[0-9]|2[0-4])$'),
  add constraint bus_app_passengers_avatar_version_check check (avatar_version > 0),
  add constraint bus_app_passengers_avatar_asset_fk foreign key (avatar_asset_id) references public.bus_app_avatar_assets(id) on delete restrict,
  add constraint bus_app_passengers_avatar_reference_check check (
    (avatar_source = 'BUILT_IN' and avatar_asset_id is null)
    or (avatar_source = 'UPLOAD' and avatar_builtin_id is null and avatar_asset_id is not null)
  );

alter table public.bus_app_buses
  add column avatar_source text not null default 'BUILT_IN',
  add column avatar_builtin_id text,
  add column avatar_asset_id uuid,
  add column avatar_version integer not null default 1,
  add column avatar_updated_at timestamptz not null default now(),
  add column avatar_updated_by uuid references auth.users(id) on delete set null;

alter table public.bus_app_buses
  add constraint bus_app_buses_avatar_source_check check (avatar_source in ('BUILT_IN','UPLOAD')),
  add constraint bus_app_buses_avatar_builtin_check check (avatar_builtin_id is null or avatar_builtin_id in ('bus-yellow-city','bus-yellow-small','bus-blue-mini','bus-green-mini','bus-orange-coach','bus-electric')),
  add constraint bus_app_buses_avatar_version_check check (avatar_version > 0),
  add constraint bus_app_buses_avatar_asset_fk foreign key (avatar_asset_id) references public.bus_app_avatar_assets(id) on delete restrict,
  add constraint bus_app_buses_avatar_reference_check check (
    (avatar_source = 'BUILT_IN' and avatar_asset_id is null)
    or (avatar_source = 'UPLOAD' and avatar_builtin_id is null and avatar_asset_id is not null)
  );

create or replace function public.bus_app_validate_avatar_asset_scope()
returns trigger language plpgsql security definer set search_path = public, pg_catalog as $$
declare target_space_id uuid;
begin
  if new.passenger_id is not null then
    select bus_space_id into target_space_id from public.bus_app_passengers where id = new.passenger_id;
    if target_space_id is null or target_space_id <> new.bus_space_id then
      raise exception using errcode = '23514', message = 'BUS_APP_AVATAR_PASSENGER_SCOPE_MISMATCH';
    end if;
  elsif new.bus_id is not null then
    select bus_space_id into target_space_id from public.bus_app_buses where id = new.bus_id;
    if target_space_id is null or target_space_id <> new.bus_space_id then
      raise exception using errcode = '23514', message = 'BUS_APP_AVATAR_BUS_SCOPE_MISMATCH';
    end if;
  elsif new.profile_user_id is distinct from new.created_by then
    raise exception using errcode = '23514', message = 'BUS_APP_AVATAR_PROFILE_OWNER_MISMATCH';
  end if;
  return new;
end;
$$;

create trigger bus_app_avatar_assets_scope_guard
before insert or update on public.bus_app_avatar_assets
for each row execute function public.bus_app_validate_avatar_asset_scope();

create or replace function public.bus_app_validate_avatar_reference()
returns trigger language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if new.avatar_source <> 'UPLOAD' then return new; end if;
  if tg_table_name = 'bus_app_profiles' and not exists (
    select 1 from public.bus_app_avatar_assets a
    where a.id = new.avatar_asset_id and a.profile_user_id = new.user_id and a.status = 'ACTIVE'
  ) then raise exception using errcode = '23514', message = 'BUS_APP_PROFILE_AVATAR_ASSET_MISMATCH'; end if;
  if tg_table_name = 'bus_app_passengers' and not exists (
    select 1 from public.bus_app_avatar_assets a
    where a.id = new.avatar_asset_id and a.passenger_id = new.id and a.bus_space_id = new.bus_space_id and a.status = 'ACTIVE'
  ) then raise exception using errcode = '23514', message = 'BUS_APP_PASSENGER_AVATAR_ASSET_MISMATCH'; end if;
  if tg_table_name = 'bus_app_buses' and not exists (
    select 1 from public.bus_app_avatar_assets a
    where a.id = new.avatar_asset_id and a.bus_id = new.id and a.bus_space_id = new.bus_space_id and a.status = 'ACTIVE'
  ) then raise exception using errcode = '23514', message = 'BUS_APP_BUS_AVATAR_ASSET_MISMATCH'; end if;
  return new;
end;
$$;

create trigger bus_app_profiles_avatar_reference_guard
before insert or update of avatar_source, avatar_asset_id on public.bus_app_profiles
for each row execute function public.bus_app_validate_avatar_reference();
create trigger bus_app_passengers_avatar_reference_guard
before update of avatar_source, avatar_asset_id on public.bus_app_passengers
for each row execute function public.bus_app_validate_avatar_reference();
create trigger bus_app_buses_avatar_reference_guard
before update of avatar_source, avatar_asset_id on public.bus_app_buses
for each row execute function public.bus_app_validate_avatar_reference();

create table public.bus_app_avatar_updates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bus_space_id uuid references public.bus_app_spaces(id) on delete cascade,
  event_type text not null check (event_type in ('PROFILE_AVATAR_UPDATED','PASSENGER_AVATAR_UPDATED','BUS_AVATAR_UPDATED')),
  entity_id uuid not null,
  occurred_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);
create index bus_app_avatar_updates_user_idx on public.bus_app_avatar_updates(user_id, occurred_at desc);

alter table public.bus_app_profiles enable row level security;
alter table public.bus_app_avatar_assets enable row level security;
alter table public.bus_app_avatar_updates enable row level security;
revoke all on public.bus_app_profiles, public.bus_app_avatar_assets, public.bus_app_avatar_updates from anon, authenticated;

grant select on public.bus_app_avatar_updates to authenticated;
create policy bus_app_avatar_updates_own_read on public.bus_app_avatar_updates
for select to authenticated using (user_id = auth.uid());

revoke all on function public.bus_app_validate_avatar_asset_scope() from public, anon, authenticated;
revoke all on function public.bus_app_validate_avatar_reference() from public, anon, authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('bus-app-private-media', 'bus-app-private-media', false, 5242880, array['image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'bus_app_avatar_updates'
  ) then alter publication supabase_realtime add table public.bus_app_avatar_updates; end if;
end $$;

create or replace function public.purge_expired_bus_app_runtime_data()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.bus_app_trip_location_events where expires_at <= now();
  delete from public.bus_app_parent_trip_updates where expires_at <= now();
  delete from public.bus_app_avatar_updates where expires_at <= now();
  delete from public.bus_app_idempotency_keys where expires_at <= now();
  delete from public.bus_app_code_attempts where attempted_at < now() - interval '7 days';
  delete from public.bus_app_geocode_cache where expires_at <= now();
end;
$$;
revoke all on function public.purge_expired_bus_app_runtime_data() from public, anon, authenticated;
grant execute on function public.purge_expired_bus_app_runtime_data() to service_role;

comment on table public.bus_app_profiles is 'Canonical BusApp user profile; private photos are referenced through bus_app_avatar_assets.';
comment on table public.bus_app_avatar_assets is 'Private, server-sanitized BusApp WebP media with explicit profile/passenger/bus ownership.';
comment on table public.bus_app_avatar_updates is 'Coordinate-free user-targeted realtime invalidation pulses for authorized avatar refresh.';

commit;
