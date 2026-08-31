-- BusApp V2.3 — routing/geocoding provider usage.
--
-- The free openrouteservice tier is a shared quota, so BusApp meters its own calls server
-- side. This is deliberately NOT the audit log: these rows are high-volume operational
-- counters that expire, while audit events are a durable record of who did what.
-- Additive and rollback-safe: nothing existing is altered.

begin;

create table public.bus_app_routing_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  operation text not null check (operation in ('geocode','route.optimize','route.recalculate')),
  outcome text not null default 'REQUESTED' check (outcome in ('REQUESTED','ROAD','ESTIMATE','FAILED')),
  provider text,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

create index bus_app_routing_usage_window_idx
  on public.bus_app_routing_usage(user_id, operation, created_at desc);
create index bus_app_routing_usage_expiry_idx
  on public.bus_app_routing_usage(expires_at);

alter table public.bus_app_routing_usage enable row level security;
revoke all on public.bus_app_routing_usage from anon, authenticated;

-- Keep the counters bounded through the existing runtime purge.
create or replace function public.purge_expired_bus_app_runtime_data()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.bus_app_trip_location_events where expires_at <= now();
  delete from public.bus_app_parent_trip_updates where expires_at <= now();
  delete from public.bus_app_avatar_updates where expires_at <= now();
  delete from public.bus_app_routing_usage where expires_at <= now();
  delete from public.bus_app_idempotency_keys where expires_at <= now();
  delete from public.bus_app_code_attempts where attempted_at < now() - interval '7 days';
  delete from public.bus_app_geocode_cache where expires_at <= now();
end;
$$;
revoke all on function public.purge_expired_bus_app_runtime_data() from public, anon, authenticated;
grant execute on function public.purge_expired_bus_app_runtime_data() to service_role;

comment on table public.bus_app_routing_usage is
  'Expiring server-side meter for external routing/geocoding calls. Protects the shared free provider quota and feeds lightweight provider diagnostics.';

commit;
