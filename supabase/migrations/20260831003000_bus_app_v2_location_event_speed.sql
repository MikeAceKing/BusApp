-- Keep the short-lived GPS history payload aligned with the live bus position.
-- This remains bus telemetry only; no parent or passenger location is stored.
begin;

alter table public.bus_app_trip_location_events
  add column if not exists speed_mps double precision
  check (speed_mps is null or speed_mps between 0 and 80);

comment on column public.bus_app_trip_location_events.speed_mps is
  'Optional bus speed captured with a short-lived GPS event; purged with the event.';

commit;
