import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const migration=readFileSync(new URL('../../supabase/migrations/20260831054000_bus_app_profiles_and_private_avatars.sql',import.meta.url),'utf8');
const api=readFileSync(new URL('../../supabase/functions/bus-app/index.ts',import.meta.url),'utf8');
const media=readFileSync(new URL('../../supabase/functions/bus-app-media/index.ts',import.meta.url),'utf8');
const processor=readFileSync(new URL('../../supabase/functions/bus-app-media/image-core.ts',import.meta.url),'utf8');

test('canonical profiles and private media are additive and RLS protected',()=>{
  assert.match(migration,/create table public\.bus_app_profiles/);
  assert.match(migration,/create table public\.bus_app_avatar_assets/);
  assert.match(migration,/alter table public\.bus_app_profiles enable row level security/);
  assert.match(migration,/revoke all on public\.bus_app_profiles, public\.bus_app_avatar_assets/);
  assert.match(migration,/values \('bus-app-private-media',[\s\S]*false, 5242880/);
  assert.doesNotMatch(migration,/create policy[\s\S]*storage\.objects/i);
});

test('photo function enforces exact actor permissions and explicit target scope',()=>{
  assert.match(media,/membership\(user, spaceId, \['OWNER', 'ATTENDANT'\]\)/);
  assert.match(media,/membership\(user, spaceId, \['OWNER'\]\)/);
  assert.match(media,/bus_app_parent_access_passengers/);
  assert.match(media,/\.eq\('passenger_id', passengerId\)/);
  assert.match(media,/profile_user_id: target\.kind === 'PROFILE' \? target\.entityId : null/);
  assert.match(media,/passenger_id: target\.kind === 'PASSENGER' \? target\.entityId : null/);
  assert.match(media,/bus_id: target\.kind === 'BUS' \? target\.entityId : null/);
});

test('uploads reject disguised or active content and store sanitized WebP only',()=>{
  assert.match(media,/5 \* 1024 \* 1024/);
  assert.match(media,/image\/jpeg.*image\/png.*image\/webp/);
  assert.match(media,/IMAGE_MAGIC_MISMATCH/);
  assert.match(processor,/IMAGE_MAGIC_INVALID/);
  assert.match(processor,/images\.length !== 1/);
  assert.match(processor,/image\.autoOrient\(\)/);
  assert.match(processor,/image\.strip\(\)/);
  assert.match(processor,/runtime\.MagickFormat\.WebP/);
  assert.match(processor,/50_000_000/);
  assert.doesNotMatch(media,/image\/svg|text\/html|image\/gif|application\/pdf/);
});

test('avatar refresh is user targeted and canonical in parent, staff and trip responses',()=>{
  assert.match(migration,/using \(user_id = auth\.uid\(\)\)/);
  assert.match(api,/bus_app_avatar_updates/);
  assert.match(api,/withAvatars\(rows\(passengers\.data\)\)/);
  assert.match(api,/decoratedCurrent\.find/);
  assert.match(api,/PASSENGER_AVATAR_FORBIDDEN/);
});

test('the local catalog contains the promised original SVG choices',()=>{
  const names=readdirSync(new URL('../../app/public/avatars/',import.meta.url));
  assert.equal(names.filter((name)=>/^child-\d{2}\.svg$/.test(name)).length,24);
  assert.equal(names.filter((name)=>/^adult-\d{2}\.svg$/.test(name)).length,8);
  assert.equal(names.filter((name)=>/^bus-.+\.svg$/.test(name)).length,6);
});
