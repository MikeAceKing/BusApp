-- Ensure the polymorphic trigger never reads a column absent from the current
-- table record. This keeps the canonical asset scope guard effective for all
-- three avatar owners.
begin;

create or replace function public.bus_app_validate_avatar_reference()
returns trigger language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if new.avatar_source <> 'UPLOAD' then return new; end if;
  if tg_table_name = 'bus_app_profiles' then
    if not exists (
      select 1 from public.bus_app_avatar_assets a
      where a.id = new.avatar_asset_id and a.profile_user_id = new.user_id and a.status = 'ACTIVE'
    ) then raise exception using errcode = '23514', message = 'BUS_APP_PROFILE_AVATAR_ASSET_MISMATCH'; end if;
  elsif tg_table_name = 'bus_app_passengers' then
    if not exists (
      select 1 from public.bus_app_avatar_assets a
      where a.id = new.avatar_asset_id and a.passenger_id = new.id and a.bus_space_id = new.bus_space_id and a.status = 'ACTIVE'
    ) then raise exception using errcode = '23514', message = 'BUS_APP_PASSENGER_AVATAR_ASSET_MISMATCH'; end if;
  elsif tg_table_name = 'bus_app_buses' then
    if not exists (
      select 1 from public.bus_app_avatar_assets a
      where a.id = new.avatar_asset_id and a.bus_id = new.id and a.bus_space_id = new.bus_space_id and a.status = 'ACTIVE'
    ) then raise exception using errcode = '23514', message = 'BUS_APP_BUS_AVATAR_ASSET_MISMATCH'; end if;
  else
    raise exception using errcode = '23514', message = 'BUS_APP_AVATAR_REFERENCE_TABLE_INVALID';
  end if;
  return new;
end;
$$;

revoke all on function public.bus_app_validate_avatar_reference() from public, anon, authenticated;

commit;
