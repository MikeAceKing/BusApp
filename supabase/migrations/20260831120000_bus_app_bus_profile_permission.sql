-- BusApp V2.2 — materialize the Bus Space permission that governs bus profile editing.
-- The server already resolves an explicit member grant before falling back to the role
-- default; this makes the grant explicit in stored data so a denial can be recorded per
-- member without changing anyone's role.

begin;

update public.bus_app_members
set permissions = permissions || '{"MANAGE_BUS_PROFILE": true}'::jsonb,
    updated_at = now()
where active
  and role in ('OWNER','DRIVER','ATTENDANT')
  and not (permissions ? 'MANAGE_BUS_PROFILE');

comment on column public.bus_app_members.permissions is
  'Server-resolved Bus Space permissions. MANAGE_BUS_PROFILE governs editing the bus name, avatar and photo; an explicit false denies it without changing the role.';

commit;
