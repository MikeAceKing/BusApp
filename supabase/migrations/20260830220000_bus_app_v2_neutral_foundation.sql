-- BusApp V2 — neutral bus-space authority.
-- Additive only: the legacy school_bus_* domain remains available for rollback.
-- Privacy invariant: location belongs to a bus trip; no passenger or parent GPS exists.

begin;

create extension if not exists pgcrypto;

create table public.bus_app_spaces (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  avatar_key text check (avatar_key is null or avatar_key in ('bus','van','coach')),
  default_language text not null default 'nl' check (default_language in ('nl','fr')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','ARCHIVED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.bus_app_members (
  id uuid primary key default gen_random_uuid(),
  bus_space_id uuid not null references public.bus_app_spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('OWNER','DRIVER','ATTENDANT')),
  permissions jsonb not null default '{}'::jsonb check (jsonb_typeof(permissions) = 'object'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bus_space_id, user_id, role)
);

create table public.bus_app_buses (
  id uuid primary key default gen_random_uuid(),
  bus_space_id uuid not null references public.bus_app_spaces(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  avatar_key text not null default 'bus' check (avatar_key in ('bus','van','coach')),
  capacity integer not null check (capacity between 1 and 120),
  start_display_address text not null check (char_length(btrim(start_display_address)) between 5 and 300),
  start_latitude double precision not null check (start_latitude between -90 and 90),
  start_longitude double precision not null check (start_longitude between -180 and 180),
  end_display_address text check (end_display_address is null or char_length(btrim(end_display_address)) between 5 and 300),
  end_latitude double precision check (end_latitude is null or end_latitude between -90 and 90),
  end_longitude double precision check (end_longitude is null or end_longitude between -180 and 180),
  geocoding_provider text not null,
  geocoding_reference text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bus_space_id, name),
  check ((end_latitude is null) = (end_longitude is null))
);

create table public.bus_app_stops (
  id uuid primary key default gen_random_uuid(),
  bus_space_id uuid not null references public.bus_app_spaces(id) on delete cascade,
  bus_id uuid not null references public.bus_app_buses(id) on delete cascade,
  label text check (label is null or char_length(btrim(label)) between 1 and 100),
  display_address text not null check (char_length(btrim(display_address)) between 5 and 300),
  normalized_address text not null check (char_length(normalized_address) between 5 and 300),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  geocoding_provider text not null,
  geocoding_reference text,
  expected_passenger_count integer not null default 1 check (expected_passenger_count between 0 and 120),
  manual_sequence integer not null check (manual_sequence between 1 and 500),
  geofence_radius_meters integer not null default 100 check (geofence_radius_meters between 30 and 500),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index bus_app_stops_active_address_uq
  on public.bus_app_stops(bus_id, normalized_address) where active;
create unique index bus_app_stops_active_sequence_uq
  on public.bus_app_stops(bus_id, manual_sequence) where active;

create table public.bus_app_passengers (
  id uuid primary key default gen_random_uuid(),
  bus_space_id uuid not null references public.bus_app_spaces(id) on delete cascade,
  stop_id uuid not null references public.bus_app_stops(id) on delete restrict,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 50),
  avatar_key text not null default 'smile' check (avatar_key in ('smile','child','girl','star','rocket','rainbow','ball','bag')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.bus_app_parent_access (
  id uuid primary key default gen_random_uuid(),
  bus_space_id uuid not null references public.bus_app_spaces(id) on delete cascade,
  parent_display_name text not null check (char_length(btrim(parent_display_name)) between 1 and 50),
  code_hash text not null unique check (char_length(code_hash) = 64),
  code_version integer not null default 1 check (code_version > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create table public.bus_app_parent_access_passengers (
  parent_access_id uuid not null references public.bus_app_parent_access(id) on delete cascade,
  passenger_id uuid not null references public.bus_app_passengers(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (parent_access_id, passenger_id)
);

create table public.bus_app_parent_grants (
  id uuid primary key default gen_random_uuid(),
  parent_access_id uuid not null references public.bus_app_parent_access(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (parent_access_id, user_id)
);

create table public.bus_app_route_plans (
  id uuid primary key default gen_random_uuid(),
  bus_space_id uuid not null references public.bus_app_spaces(id) on delete cascade,
  bus_id uuid not null references public.bus_app_buses(id) on delete cascade,
  provider text not null,
  optimization_mode text not null check (optimization_mode in ('AUTOMATIC','MANUAL')),
  distance_meters integer not null check (distance_meters >= 0),
  duration_seconds integer not null check (duration_seconds >= 0),
  route_geometry jsonb not null default '{}'::jsonb check (jsonb_typeof(route_geometry) = 'object'),
  provider_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(provider_metadata) = 'object'),
  stale_at timestamptz,
  selected_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create unique index bus_app_route_plans_selected_uq
  on public.bus_app_route_plans(bus_id) where selected_at is not null and stale_at is null;

create table public.bus_app_route_plan_stops (
  route_plan_id uuid not null references public.bus_app_route_plans(id) on delete cascade,
  stop_id uuid not null references public.bus_app_stops(id) on delete restrict,
  sequence integer not null check (sequence between 1 and 500),
  estimated_arrival_offset_seconds integer not null default 0 check (estimated_arrival_offset_seconds >= 0),
  display_address_snapshot text not null,
  latitude_snapshot double precision not null check (latitude_snapshot between -90 and 90),
  longitude_snapshot double precision not null check (longitude_snapshot between -180 and 180),
  expected_passenger_count_snapshot integer not null check (expected_passenger_count_snapshot between 0 and 120),
  primary key (route_plan_id, stop_id),
  unique (route_plan_id, sequence)
);

create table public.bus_app_trips (
  id uuid primary key default gen_random_uuid(),
  bus_space_id uuid not null references public.bus_app_spaces(id) on delete cascade,
  bus_id uuid not null references public.bus_app_buses(id) on delete restrict,
  route_plan_id uuid not null references public.bus_app_route_plans(id) on delete restrict,
  status text not null default 'BOARDING' check (status in ('BOARDING','IN_TRANSIT','ARRIVED','COMPLETED','CANCELLED')),
  driver_session_id uuid,
  current_stop_sequence integer not null default 0 check (current_stop_sequence between 0 and 500),
  started_at timestamptz,
  arrived_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index bus_app_one_active_trip_per_bus
  on public.bus_app_trips(bus_id) where status in ('BOARDING','IN_TRANSIT','ARRIVED');

create table public.bus_app_trip_stops (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.bus_app_trips(id) on delete cascade,
  source_stop_id uuid not null references public.bus_app_stops(id) on delete restrict,
  sequence integer not null check (sequence between 1 and 500),
  display_address text not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  expected_passenger_count integer not null check (expected_passenger_count between 0 and 120),
  estimated_arrival_offset_seconds integer not null default 0,
  geofence_radius_meters integer not null default 100 check (geofence_radius_meters between 30 and 500),
  status text not null default 'PENDING' check (status in ('PENDING','APPROACHING','AT_STOP','COMPLETED','SKIPPED')),
  approached_at timestamptz,
  arrived_at timestamptz,
  completed_at timestamptz,
  unique (trip_id, source_stop_id),
  unique (trip_id, sequence)
);

create table public.bus_app_trip_passenger_statuses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.bus_app_trips(id) on delete cascade,
  passenger_id uuid not null references public.bus_app_passengers(id) on delete cascade,
  trip_stop_id uuid not null references public.bus_app_trip_stops(id) on delete restrict,
  display_name_snapshot text not null,
  avatar_key_snapshot text not null,
  status text not null default 'EXPECTED' check (status in ('EXPECTED','BOARDED','MISSED','DROPPED_OFF')),
  version integer not null default 1 check (version > 0),
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  unique (trip_id, passenger_id)
);

create table public.bus_app_trip_live_locations (
  trip_id uuid primary key references public.bus_app_trips(id) on delete cascade,
  bus_space_id uuid not null references public.bus_app_spaces(id) on delete cascade,
  bus_id uuid not null references public.bus_app_buses(id) on delete cascade,
  driver_session_id uuid not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_meters double precision check (accuracy_meters is null or accuracy_meters between 0 and 5000),
  speed_mps double precision check (speed_mps is null or speed_mps between 0 and 80),
  captured_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create table public.bus_app_trip_location_events (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.bus_app_trips(id) on delete cascade,
  bus_space_id uuid not null references public.bus_app_spaces(id) on delete cascade,
  bus_id uuid not null references public.bus_app_buses(id) on delete cascade,
  driver_session_id uuid not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_meters double precision,
  captured_at timestamptz not null,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now()
);

create table public.bus_app_parent_trip_updates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  parent_access_id uuid not null references public.bus_app_parent_access(id) on delete cascade,
  trip_id uuid not null references public.bus_app_trips(id) on delete cascade,
  event_type text not null,
  occurred_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

create table public.bus_app_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid references public.bus_app_trips(id) on delete cascade,
  event_type text not null,
  title text not null check (char_length(title) between 1 and 180),
  message text not null check (char_length(message) between 1 and 1000),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.bus_app_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  enabled boolean not null default true,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create table public.bus_app_code_attempts (
  id bigint generated always as identity primary key,
  device_user_id uuid not null references auth.users(id) on delete cascade,
  ip_hash text not null check (char_length(ip_hash) = 64),
  success boolean not null,
  parent_access_id uuid references public.bus_app_parent_access(id) on delete set null,
  attempted_at timestamptz not null default now()
);

create table public.bus_app_geocode_cache (
  query_hash text primary key check (char_length(query_hash) = 64),
  provider text not null,
  results jsonb not null check (jsonb_typeof(results) = 'array'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.bus_app_idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  operation text not null check (char_length(operation) between 3 and 100),
  idempotency_key uuid not null,
  request_hash text not null check (char_length(request_hash) = 64),
  response_status integer,
  response_body jsonb,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, operation, idempotency_key)
);

create table public.bus_app_audit_events (
  id uuid primary key default gen_random_uuid(),
  bus_space_id uuid references public.bus_app_spaces(id) on delete set null,
  trip_id uuid references public.bus_app_trips(id) on delete set null,
  passenger_id uuid references public.bus_app_passengers(id) on delete set null,
  parent_access_id uuid references public.bus_app_parent_access(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_role text,
  event_type text not null check (char_length(event_type) between 3 and 80),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index bus_app_members_user_idx on public.bus_app_members(user_id, bus_space_id) where active;
create index bus_app_stops_bus_idx on public.bus_app_stops(bus_id, manual_sequence) where active;
create index bus_app_passengers_stop_idx on public.bus_app_passengers(stop_id) where active;
create index bus_app_parent_grants_user_idx on public.bus_app_parent_grants(user_id, last_seen_at desc) where revoked_at is null;
create index bus_app_trip_stops_next_idx on public.bus_app_trip_stops(trip_id, sequence, status);
create index bus_app_trip_status_idx on public.bus_app_trip_passenger_statuses(trip_id, trip_stop_id, status);
create index bus_app_location_expiry_idx on public.bus_app_trip_location_events(expires_at);
create index bus_app_parent_updates_user_idx on public.bus_app_parent_trip_updates(user_id, occurred_at desc);
create index bus_app_notifications_user_idx on public.bus_app_notifications(user_id, created_at desc);
create index bus_app_code_attempts_device_idx on public.bus_app_code_attempts(device_user_id, attempted_at desc);
create index bus_app_code_attempts_ip_idx on public.bus_app_code_attempts(ip_hash, attempted_at desc);
create index bus_app_audit_space_idx on public.bus_app_audit_events(bus_space_id, created_at desc);

create or replace function public.bus_app_touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'bus_app_spaces','bus_app_members','bus_app_buses','bus_app_stops','bus_app_passengers',
    'bus_app_parent_access','bus_app_trips','bus_app_push_subscriptions'
  ] loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.bus_app_touch_updated_at()', table_name, table_name);
  end loop;
end $$;

create or replace function public.bus_app_mark_route_stale()
returns trigger language plpgsql set search_path = public as $$
declare target_bus uuid;
begin
  if tg_op = 'DELETE' then target_bus := old.bus_id; else target_bus := new.bus_id; end if;
  update public.bus_app_route_plans set stale_at = coalesce(stale_at, now()), selected_at = null
  where bus_id = target_bus and stale_at is null;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

create trigger bus_app_stops_stale_after_change
after insert or update or delete on public.bus_app_stops
for each row execute function public.bus_app_mark_route_stale();

create or replace function public.bus_app_clear_terminal_trip_location()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status in ('COMPLETED','CANCELLED') and old.status is distinct from new.status then
    delete from public.bus_app_trip_live_locations where trip_id = new.id;
    delete from public.bus_app_trip_location_events where trip_id = new.id;
  end if;
  return new;
end;
$$;

create trigger bus_app_clear_location_after_terminal_trip
after update of status on public.bus_app_trips
for each row execute function public.bus_app_clear_terminal_trip_location();

create or replace function public.bus_app_start_trip_snapshot(
  p_bus_id uuid,
  p_route_plan_id uuid,
  p_user_id uuid,
  p_driver_session_id uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  created_trip_id uuid;
  target_space_id uuid;
begin
  select bus_space_id into target_space_id
  from public.bus_app_route_plans
  where id = p_route_plan_id and bus_id = p_bus_id and stale_at is null and selected_at is not null;
  if target_space_id is null then raise exception using errcode = 'P0001', message = 'ROUTE_PLAN_STALE'; end if;

  insert into public.bus_app_trips(bus_space_id,bus_id,route_plan_id,status,driver_session_id,created_by)
  values (target_space_id,p_bus_id,p_route_plan_id,'BOARDING',p_driver_session_id,p_user_id)
  returning id into created_trip_id;

  insert into public.bus_app_trip_stops(
    trip_id,source_stop_id,sequence,display_address,latitude,longitude,
    expected_passenger_count,estimated_arrival_offset_seconds,geofence_radius_meters
  )
  select created_trip_id,rps.stop_id,rps.sequence,rps.display_address_snapshot,
    rps.latitude_snapshot,rps.longitude_snapshot,rps.expected_passenger_count_snapshot,
    rps.estimated_arrival_offset_seconds,coalesce(bs.geofence_radius_meters,100)
  from public.bus_app_route_plan_stops rps
  join public.bus_app_stops bs on bs.id = rps.stop_id
  where rps.route_plan_id = p_route_plan_id
  order by rps.sequence;

  insert into public.bus_app_trip_passenger_statuses(
    trip_id,passenger_id,trip_stop_id,display_name_snapshot,avatar_key_snapshot,status
  )
  select created_trip_id,p.id,ts.id,p.display_name,p.avatar_key,'EXPECTED'
  from public.bus_app_passengers p
  join public.bus_app_trip_stops ts on ts.trip_id = created_trip_id and ts.source_stop_id = p.stop_id
  where p.active;

  return created_trip_id;
end;
$$;

create or replace function public.purge_expired_bus_app_runtime_data()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.bus_app_trip_location_events where expires_at <= now();
  delete from public.bus_app_parent_trip_updates where expires_at <= now();
  delete from public.bus_app_idempotency_keys where expires_at <= now();
  delete from public.bus_app_code_attempts where attempted_at < now() - interval '7 days';
  delete from public.bus_app_geocode_cache where expires_at <= now();
end;
$$;

revoke all on function public.bus_app_touch_updated_at() from public, anon, authenticated;
revoke all on function public.bus_app_mark_route_stale() from public, anon, authenticated;
revoke all on function public.bus_app_clear_terminal_trip_location() from public, anon, authenticated;
revoke all on function public.bus_app_start_trip_snapshot(uuid,uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.purge_expired_bus_app_runtime_data() from public, anon, authenticated;
grant execute on function public.bus_app_start_trip_snapshot(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.purge_expired_bus_app_runtime_data() to service_role;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'bus_app_spaces','bus_app_members','bus_app_buses','bus_app_stops','bus_app_passengers',
    'bus_app_parent_access','bus_app_parent_access_passengers','bus_app_parent_grants',
    'bus_app_route_plans','bus_app_route_plan_stops','bus_app_trips','bus_app_trip_stops',
    'bus_app_trip_passenger_statuses','bus_app_trip_live_locations','bus_app_trip_location_events',
    'bus_app_parent_trip_updates','bus_app_notifications','bus_app_push_subscriptions',
    'bus_app_code_attempts','bus_app_geocode_cache','bus_app_idempotency_keys','bus_app_audit_events'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from anon, authenticated', table_name);
  end loop;
end $$;

-- Browser-side Realtime receives only user-targeted pulses and notification copy.
grant select on public.bus_app_parent_trip_updates, public.bus_app_notifications to authenticated;
create policy bus_app_parent_updates_own_read on public.bus_app_parent_trip_updates
for select to authenticated using (user_id = auth.uid());
create policy bus_app_notifications_own_read on public.bus_app_notifications
for select to authenticated using (user_id = auth.uid());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'bus_app_parent_trip_updates'
  ) then alter publication supabase_realtime add table public.bus_app_parent_trip_updates; end if;
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'bus_app_notifications'
  ) then alter publication supabase_realtime add table public.bus_app_notifications; end if;
end $$;

comment on table public.bus_app_spaces is 'Primary BusApp authority; no school, company, tenant or subscription is required.';
comment on table public.bus_app_parent_grants is 'Server-issued device/session grants after a parent code is verified.';
comment on table public.bus_app_trip_live_locations is 'Bus-only live position. Never a child or parent position.';
do $$
begin
  if to_regclass('public.school_bus_schools') is not null then
    comment on table public.school_bus_schools is 'Legacy rollback authority; deprecated by BusApp V2.';
  end if;
end $$;

commit;
