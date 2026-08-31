-- BusApp fix — allow a route plan to be deselected.
--
-- bus_app_route_plans.selected_at was created NOT NULL, but the partial unique index
--   (bus_id) where selected_at is not null and stale_at is null
-- only makes sense if NULL is the "not selected" marker, and two code paths already rely
-- on that: bus_app_mark_route_stale() and the route optimize endpoint both set
-- selected_at = null before a newer plan is stored.
--
-- With the NOT NULL in place both of those writes fail, so recalculating a route returned
-- a 23505 conflict from the unique index, and changing a stop while a plan existed raised
-- from the trigger. Dropping the constraint restores the documented intent.
--
-- Additive and rollback-safe: no data is rewritten and no existing row changes meaning.

begin;

alter table public.bus_app_route_plans alter column selected_at drop not null;

comment on column public.bus_app_route_plans.selected_at is
  'When this plan became the selected plan for its bus. NULL means superseded; the partial unique index keeps at most one selected, non-stale plan per bus.';

commit;
