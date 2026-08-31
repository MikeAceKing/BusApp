begin;

alter table public.bus_app_passengers
  drop constraint if exists bus_app_passengers_avatar_key_check;

update public.bus_app_passengers
set avatar_key = case avatar_key
  when 'smile' then 'initials-blue'
  when 'child' then 'initials-green'
  when 'girl' then 'initials-rose'
  when 'star' then 'initials-orange'
  when 'rocket' then 'initials-purple'
  when 'rainbow' then 'initials-rose'
  when 'ball' then 'initials-green'
  when 'bag' then 'initials-blue'
  else avatar_key
end
where avatar_key in ('smile','child','girl','star','rocket','rainbow','ball','bag');

alter table public.bus_app_passengers
  alter column avatar_key set default 'initials-blue';

alter table public.bus_app_passengers
  add constraint bus_app_passengers_avatar_key_check
  check (avatar_key in ('initials-blue','initials-green','initials-purple','initials-orange','initials-rose'));

commit;
