import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const foundation = readFileSync('supabase/migrations/20260830220000_bus_app_v2_neutral_foundation.sql', 'utf8');
const speedPatch = readFileSync('supabase/migrations/20260831003000_bus_app_v2_location_event_speed.sql', 'utf8');
const avatarPatch = readFileSync('supabase/migrations/20260831013000_bus_app_v2_avatar_styles.sql', 'utf8');
const profilePatch = readFileSync('supabase/migrations/20260831054000_bus_app_profiles_and_private_avatars.sql', 'utf8');
const referenceGuardFix = readFileSync('supabase/migrations/20260831055000_bus_app_avatar_reference_guard_fix.sql', 'utf8');
const busPermissionPatch = readFileSync('supabase/migrations/20260831120000_bus_app_bus_profile_permission.sql', 'utf8');
const server = readFileSync('supabase/functions/bus-app/index.ts', 'utf8');
const schemas = readFileSync('supabase/functions/bus-app/schemas.ts', 'utf8');
const routing = readFileSync('supabase/functions/bus-app/routing.ts', 'utf8');
const notifications = readFileSync('supabase/functions/bus-app/notifications.ts', 'utf8');
const media = readFileSync('supabase/functions/bus-app-media/index.ts', 'utf8');
const mediaImage = readFileSync('supabase/functions/bus-app-media/image-core.ts', 'utf8');
const mediaRuntime = readFileSync('supabase/functions/bus-app-media/image.ts', 'utf8');
const app = readFileSync('app/src/App.tsx', 'utf8');
const parentUi = readFileSync('app/src/components/ParentCode.tsx', 'utf8');
const staffHome = readFileSync('app/src/components/BusHome.tsx', 'utf8');
const parentHome = readFileSync('app/src/components/ParentBusHome.tsx', 'utf8');
const shared = readFileSync('app/src/components/Shared.tsx', 'utf8');
const busHome = readFileSync('app/src/components/BusHome.tsx', 'utf8');
const avatarProfiles = readFileSync('app/src/components/AvatarProfiles.tsx', 'utf8');
const passengerManager = readFileSync('app/src/components/PassengerManager.tsx', 'utf8');

test('Bus Space is the primary neutral authority and legacy SchoolBus remains rollback-only', () => {
  assert.match(foundation, /create table public\.bus_app_spaces/);
  assert.match(foundation, /owner_user_id uuid not null references auth\.users/);
  const primaryTables = foundation.match(/create table public\.bus_app_[a-z_]+/g) || [];
  assert.ok(primaryTables.length >= 20);
  for (const source of [server, schemas, routing, notifications, app, parentUi]) {
    assert.doesNotMatch(source, /tenant_id|school_id|company_id|organization_id/);
  }
  assert.match(foundation, /legacy school_bus_\* domain remains available for rollback/i);
});

test('private BusApp tables enforce RLS and browsers can only read own realtime pulses', () => {
  assert.match(foundation, /alter table public\.%I enable row level security/);
  assert.match(foundation, /revoke all on public\.%I from anon, authenticated/);
  assert.doesNotMatch(foundation, /grant (insert|update|delete|all).*authenticated/i);
  assert.match(foundation, /grant select on public\.bus_app_parent_trip_updates, public\.bus_app_notifications to authenticated/);
  assert.match(foundation, /using \(user_id = auth\.uid\(\)\)/);
  assert.match(server, /accessForSpace[\s\S]*bus_app_members[\s\S]*user\.id/);
});

test('parent access is anonymous-device compatible, HMAC-only, rate limited and revocable', () => {
  assert.match(parentUi, /signInAnonymously/);
  assert.doesNotMatch(parentUi, /email|password/i);
  assert.match(server, /BUS_APP_CODE_HASH_SECRET/);
  assert.match(server, /HMAC/);
  assert.match(server, /CODE_RATE_LIMITED/);
  assert.match(server, /deviceAttempts\.count/);
  assert.match(server, /ipAttempts\.count/);
  assert.match(server, /300-\(Date\.now\(\)-started\)/);
  assert.match(server, /parent-access\/:accessId\/regenerate/);
  assert.match(server, /parent-access\/:accessId\/revoke/);
  const accessTable = foundation.match(/create table public\.bus_app_parent_access \([\s\S]*?\n\);/)?.[0] || '';
  assert.match(accessTable, /code_hash text not null unique/);
  assert.doesNotMatch(accessTable, /\bcode\b text/i);
});

test('parent responses are filtered to granted passengers, own stops and rounded bus telemetry', () => {
  assert.match(server, /bus_app_parent_access_passengers/);
  assert.match(server, /\.in\('id',passengerIds\)/);
  assert.match(server, /\.in\('id',stopIds\)/);
  assert.match(server, /Math\.round\(numberValue\(locationResult\.data\.latitude\)\*1000\)\/1000/);
  const parentHandler = server.match(/app\.get\('\/parent\/home'[\s\S]*?\n\}catch\(error\)\{return handleError\(c,error\);\}\}\);/)?.[0] || '';
  assert.doesNotMatch(parentHandler, /route_geometry|members|parent_display_name.*other/i);
});

test('route optimization is provider-abstracted and trips use immutable snapshots', () => {
  for (const provider of ["provider === 'vroom'", "provider === 'osrm'", "provider === 'local'"]) assert.match(routing, new RegExp(provider.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(routing, /nearest_neighbor_2opt/);
  assert.match(routing, /manual_snapshot/);
  assert.match(routing, /geometrySource: 'estimate'/);
  assert.match(routing, /geometrySource: payload\.trips\[0\]\.geometry \? 'road' : 'waypoints'/);
  assert.match(routing, /geometrySource:'waypoints'/);
  assert.match(foundation, /create table public\.bus_app_route_plan_stops/);
  assert.match(foundation, /create table public\.bus_app_trip_stops/);
  assert.match(foundation, /display_address_snapshot/);
  assert.match(foundation, /bus_app_start_trip_snapshot/);
  assert.match(foundation, /bus_app_stops_stale_after_change/);
});

test('passenger avatars use reversible initials styles instead of pictograms', () => {
  assert.match(avatarPatch, /drop constraint if exists bus_app_passengers_avatar_key_check/);
  assert.match(avatarPatch, /alter column avatar_key set default 'initials-blue'/);
  for (const style of ['initials-blue', 'initials-green', 'initials-purple', 'initials-orange', 'initials-rose']) {
    assert.match(schemas, new RegExp(style));
    assert.match(avatarPatch, new RegExp(style));
  }
  assert.doesNotMatch(schemas, /'smile'|'rocket'|'rainbow'/);
});

test('GPS belongs to a bus trip, expires, clears on terminal state and supports speed history', () => {
  for (const table of ['bus_app_trip_live_locations', 'bus_app_trip_location_events']) assert.match(foundation, new RegExp(`create table public\\.${table}`));
  for (const table of ['bus_app_passengers', 'bus_app_parent_access', 'bus_app_parent_grants']) {
    const definition = foundation.match(new RegExp(`create table public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0] || '';
    assert.doesNotMatch(definition, /latitude|longitude|gps/i);
  }
  assert.match(foundation, /now\(\) \+ interval '24 hours'/);
  assert.match(foundation, /new\.status in \('COMPLETED','CANCELLED'\)/);
  assert.match(foundation, /purge_expired_bus_app_runtime_data/);
  assert.match(speedPatch, /add column if not exists speed_mps/);
  assert.match(server, /LOCATION_STALE/);
  assert.match(server, /distanceMeters[\s\S]*geofence_radius_meters/);
});

test('canonical profiles and private avatar assets stay server-owned and RLS-locked', () => {
  assert.match(profilePatch, /create table public\.bus_app_profiles/);
  assert.match(profilePatch, /create table public\.bus_app_avatar_assets/);
  assert.match(profilePatch, /check \(num_nonnulls\(profile_user_id, passenger_id, bus_id\) = 1\)/);
  for (const table of ['bus_app_profiles', 'bus_app_avatar_assets', 'bus_app_avatar_updates']) {
    assert.match(profilePatch, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(profilePatch, /revoke all on public\.bus_app_profiles, public\.bus_app_avatar_assets, public\.bus_app_avatar_updates from anon, authenticated/);
  const authenticatedGrants = profilePatch.match(/^grant .*to authenticated;$/gm) || [];
  assert.deepEqual(authenticatedGrants, ['grant select on public.bus_app_avatar_updates to authenticated;']);
  assert.match(profilePatch, /using \(user_id = auth\.uid\(\)\)/);
  assert.match(profilePatch, /values \('bus-app-private-media', 'bus-app-private-media', false, 5242880, array\['image\/webp'\]\)/);
  assert.match(profilePatch, /public = false/);
});

test('the avatar reference guard is polymorphic-safe for profiles, passengers and buses', () => {
  const guard = referenceGuardFix.match(/create or replace function public\.bus_app_validate_avatar_reference\(\)[\s\S]*?\n\$\$;/)?.[0] || '';
  assert.ok(guard);
  assert.match(guard, /if tg_table_name = 'bus_app_profiles' then/);
  assert.match(guard, /elsif tg_table_name = 'bus_app_passengers' then/);
  assert.match(guard, /elsif tg_table_name = 'bus_app_buses' then/);
  assert.match(guard, /else\n\s*raise exception using errcode = '23514', message = 'BUS_APP_AVATAR_REFERENCE_TABLE_INVALID'/);
  // A bus_app_profiles record has no id/bus_space_id column, so no branch may be
  // reachable for a table other than the one whose columns it reads.
  assert.doesNotMatch(guard, /if tg_table_name = 'bus_app_(passengers|buses)' and not exists/);
  for (const trigger of ['bus_app_profiles_avatar_reference_guard', 'bus_app_passengers_avatar_reference_guard', 'bus_app_buses_avatar_reference_guard']) {
    assert.match(profilePatch, new RegExp(`create trigger ${trigger}`));
  }
  assert.match(referenceGuardFix, /revoke all on function public\.bus_app_validate_avatar_reference\(\) from public, anon, authenticated/);
});

test('avatar uploads are authorized per owner and sanitized before private storage', () => {
  assert.match(media, /if \(!authorization\.startsWith\('Bearer '\)\) throw new HttpError\(401, 'AUTH_REQUIRED'/);
  assert.match(media, /membership\(user, spaceId, \['OWNER', 'ATTENDANT'\]\)/);
  assert.match(media, /membership\(user, spaceId, \['OWNER'\]\)/);
  assert.match(media, /bus_app_parent_grants[\s\S]*bus_app_parent_access[\s\S]*bus_app_parent_access_passengers/);
  assert.match(media, /PASSENGER_AVATAR_FORBIDDEN/);
  assert.doesNotMatch(media, /body\.role|payload\.role|tenant_id|school_id/);
  assert.match(media, /IMAGE_MAGIC_MISMATCH/);
  assert.match(media, /detectImageFormat\(bytes\)/);
  assert.match(media, /maxUploadBytes = 5 \* 1024 \* 1024/);
  assert.match(media, /acceptedDeclaredTypes = new Set\(\['image\/jpeg', 'image\/png', 'image\/webp'\]\)/);
  assert.match(mediaImage, /image\.strip\(\)/);
  assert.match(mediaImage, /ANIMATED_IMAGE_NOT_ALLOWED/);
  assert.match(mediaImage, /MagickFormat\.WebP/);
  assert.match(mediaRuntime, /Deno\.readFile\(new URL\('\.\/magick\.wasm', import\.meta\.url\)\)/);
  assert.match(media, /const bucket = 'bus-app-private-media'/);
  assert.match(media, /createSignedUrl\(thumbnailPath, 300\)/);
  for (const source of [media, server]) assert.doesNotMatch(source, /getPublicUrl/);
  assert.match(media, /\.eq\('avatar_version', target\.version\)/);
  assert.match(media, /AVATAR_CONFLICT/);
  assert.match(media, /storage\.from\(bucket\)\.remove\(\[storagePath, thumbnailPath\]\)/);
});

test('avatar refresh pulses are user-targeted, coordinate-free and expire', () => {
  const updates = profilePatch.match(/create table public\.bus_app_avatar_updates \([\s\S]*?\n\);/)?.[0] || '';
  assert.ok(updates);
  assert.doesNotMatch(updates, /latitude|longitude|gps/i);
  assert.match(updates, /user_id uuid not null references auth\.users\(id\) on delete cascade/);
  for (const event of ['PROFILE_AVATAR_UPDATED', 'PASSENGER_AVATAR_UPDATED', 'BUS_AVATAR_UPDATED']) assert.match(updates, new RegExp(event));
  assert.match(updates, /expires_at timestamptz not null default \(now\(\) \+ interval '24 hours'\)/);
  assert.match(profilePatch, /delete from public\.bus_app_avatar_updates where expires_at <= now\(\)/);
  for (const client of [staffHome, parentHome]) {
    assert.match(client, /table: ?'bus_app_avatar_updates'/);
    assert.match(client, /filter: ?`user_id=eq\.\$\{[a-zA-Z.]+\.id\}`/);
  }
});

test('the authenticated app renders no BusApp-controlled top bar', () => {
  // The shared page header component is gone, not merely unused.
  assert.doesNotMatch(shared, /PageHeader|page-header/);
  for (const [name, source] of [['BusHome', busHome], ['ParentBusHome', parentHome]]) {
    assert.doesNotMatch(source, /PageHeader/, `${name} must not render a global header`);
    assert.doesNotMatch(source, /<Brand\b/, `${name} must not repeat the BusApp wordmark`);
  }
  // Each page names itself inside its own content instead.
  for (const source of [busHome, parentHome, passengerManager]) assert.match(source, /className="section-heading"/);
  // Logout and the access switch live on Profile, not in a header action.
  for (const source of [busHome, parentHome]) {
    assert.match(source, /logout-button[\s\S]*signOut/);
    assert.match(source, /onClick=\{onExit\}[\s\S]*switchMode/);
  }
});

test('a personal profile is a person and is never seeded from a bus name', () => {
  // The staff profile card receives no Bus Space name as its fallback identity.
  assert.doesNotMatch(busHome, /fallbackName=\{home\.space\.name\}/);
  assert.doesNotMatch(busHome, /fallbackName=\{[^}]*bus[^}]*\}/i);
  assert.match(avatarProfiles, /fallbackName='BusApp'/);
  // Person and bus are rendered by two different components.
  assert.match(avatarProfiles, /export function UserProfileEditor/);
  assert.match(avatarProfiles, /export function BusProfileCard/);
  assert.match(busHome, /<UserProfileEditor[^>]*role=\{role\}/);
  assert.match(busHome, /<BusProfileCard/);
  // The person's role is a translated label, not a raw enum.
  for (const key of ['roleDriver', 'roleAttendant', 'roleParent', 'roleOwner']) assert.match(avatarProfiles, new RegExp(`t\\('${key}'\\)`));
});

test('profiles open in read mode and edit with explicit cancel and save', () => {
  // No permanently exposed text input and no icon-only save control.
  assert.match(avatarProfiles, /t\('editProfile'\)/);
  assert.match(avatarProfiles, /t\('editBus'\)/);
  assert.match(passengerManager, /t\('editAvatar'\)/);
  assert.doesNotMatch(avatarProfiles, /aria-label=\{t\('save'\)\}/);
  assert.doesNotMatch(avatarProfiles, /\bSave\b/);
  for (const marker of [/t\('cancelEdit'\)/, /className="edit-actions"/, /className="profile-edit-panel"/]) assert.match(avatarProfiles, marker);
  // Name input only exists while editing.
  assert.match(avatarProfiles, /\{profile&&editing&&<div className="profile-edit-panel">/);
  assert.match(avatarProfiles, /\{editable&&editing&&<div className="profile-edit-panel">/);
});

test('bus profile editing is a server-resolved Bus Space permission', () => {
  // The permission is resolved from the stored member record, never from a client role.
  assert.match(server, /const busSpacePermissionDefaults:Record<string,Record<BusSpaceRole,boolean>>/);
  assert.match(server, /function hasBusSpacePermission\(access:Access,permission:keyof typeof busSpacePermissionDefaults\):boolean/);
  assert.match(server, /const explicit=access\.permissions\[permission\];\n  if\(typeof explicit==='boolean'\)return explicit;/);
  assert.match(server, /if\(!hasBusSpacePermission\(access,'MANAGE_BUS_PROFILE'\)\)throw new HttpError\(403,'BUS_PROFILE_FORBIDDEN'/);
  // The bus profile route no longer hard-codes the OWNER role.
  const busRoute = server.match(/app\.patch\('\/spaces\/:spaceId\/buses\/:busId\/profile'[\s\S]*?\n\}catch\(error\)\{return handleError\(c,error\);\}\}\);/)?.[0] || '';
  assert.ok(busRoute);
  assert.doesNotMatch(busRoute, /accessForSpace\(c\.req\.raw,c\.req\.param\('spaceId'\),\['OWNER'\]\)/);
  // The stored permission is materialized for existing members.
  assert.match(busPermissionPatch, /update public\.bus_app_members/);
  assert.match(busPermissionPatch, /permissions \|\| '\{"MANAGE_BUS_PROFILE": true\}'::jsonb/);
  assert.match(busPermissionPatch, /not \(permissions \? 'MANAGE_BUS_PROFILE'\)/);
  // The client only mirrors what the server resolved.
  assert.match(server, /permissions:\{manageBusProfile:hasBusSpacePermission\(access,'MANAGE_BUS_PROFILE'\)\}/);
  assert.match(busHome, /home\.permissions\?\.manageBusProfile/);
});

test('the parent bus profile is a filtered server-built DTO', () => {
  const route = server.match(/app\.get\('\/parent\/bus-profile'[\s\S]*?\n\}catch\(error\)\{return handleError\(c,error\);\}\}\);/)?.[0] || '';
  assert.ok(route);
  // Authority is derived: grant -> access -> passengers -> stops -> bus.
  assert.match(route, /bus_app_parent_grants[\s\S]*bus_app_parent_access\b[\s\S]*bus_app_parent_access_passengers[\s\S]*bus_app_passengers[\s\S]*bus_app_stops[\s\S]*bus_app_buses/);
  assert.match(route, /PARENT_ACCESS_REQUIRED/);
  assert.match(route, /PARENT_ACCESS_REVOKED/);
  // The response carries a named subset only.
  assert.match(route, /return c\.json\(\{bus:\{displayName:[\s\S]*driver:staff\.driver,attendant:staff\.attendant,ownStop:/);
  assert.doesNotMatch(route, /select\('\*'\)/);
  // Staff exposure is limited to a display name, a role and an avatar.
  const staff = server.match(/async function parentVisibleStaff\([\s\S]*?\n\}/)?.[0] || '';
  assert.ok(staff);
  assert.match(staff, /select\('user_id,role'\)/);
  assert.match(staff, /select\('user_id,display_name,avatar_source,avatar_builtin_id,avatar_asset_id,avatar_version'\)/);
  assert.match(staff, /return \{displayName:text\(profile\.display_name\),role,avatar:await avatarReference\(profile\)\}/);
  for (const forbidden of [/email/i, /phone/i, /permissions/, /created_at/]) assert.doesNotMatch(staff, forbidden);
  // There is no parent-facing membership or bus directory.
  assert.doesNotMatch(server, /app\.get\('\/parent\/(members|drivers|buses)'/);
  // The client renders only the safe DTO.
  assert.match(parentHome, /ParentVisibleBusProfile/);
  assert.match(parentHome, /parent\/bus-profile\?grantId=/);
  assert.match(parentHome, /className="parent-bus-cta"/);
});

test('one canonical passenger avatar is shared by parents and bus staff', () => {
  // Both sides write the same passenger row through the same helper.
  assert.match(server, /app\.patch\('\/parent\/passengers\/:passengerId\/avatar'[\s\S]*updatePassengerAvatar\(c\.req\.raw,'',c\.req\.param\('passengerId'\),true\)/);
  assert.match(server, /app\.patch\('\/spaces\/:spaceId\/passengers\/:passengerId\/avatar'[\s\S]*updatePassengerAvatar\(c\.req\.raw,c\.req\.param\('spaceId'\),c\.req\.param\('passengerId'\)\)/);
  assert.match(media, /app\.post\('\/parent\/passengers\/:passengerId'[\s\S]*upload\(c\.req\.raw, 'PASSENGER', undefined, c\.req\.param\('passengerId'\), true\)/);
  assert.match(media, /app\.post\('\/spaces\/:spaceId\/passengers\/:passengerId'/);
  // No per-audience avatar column exists.
  for (const source of [foundation, profilePatch]) {
    assert.doesNotMatch(source, /parent_avatar|staff_avatar|avatar_for_parent|avatar_for_staff/i);
  }
  // Every write fans a pulse out to members and to the granted parents.
  assert.match(server, /async function avatarRecipients\(spaceId:string,kind:'PASSENGER'\|'BUS',entityId:string\)/);
  assert.match(server, /recipients\.push\(\.\.\.\(await parentRecipientsForPassengers\(\[entityId\]\)\)\.userIds\)/);
  assert.match(server, /await emitAvatarPulse\(await avatarRecipients\(spaceId,'PASSENGER',passengerId\),spaceId,'PASSENGER_AVATAR_UPDATED',passengerId\)/);
  assert.match(media, /const recipients = await pulseRecipients\(target\)/);
});

test('parent arrival estimates follow real progress instead of the departure schedule', () => {
  // The anchor is the last stop the bus actually served, not started_at, so a delay earlier
  // in the route does not silently expire the estimate of a parent further down the line.
  assert.match(server, /const servedStops=progressStops\.filter\(\(item\)=>\['COMPLETED','SKIPPED'\]\.includes\(text\(item\.status\)\)&&text\(item\.completed_at\)\)/);
  assert.match(server, /const anchorAt=anchorStop\?Date\.parse\(text\(anchorStop\.completed_at\)\):Date\.parse\(text\(trip\.data\?\.started_at\)\)/);
  assert.match(server, /const anchorOffset=anchorStop\?numberValue\(anchorStop\.estimated_arrival_offset_seconds\):0/);
  // Only the travel still ahead of the anchor is counted.
  assert.match(server, /const remainingSeconds=tripStop\?Math\.max\(0,numberValue\(tripStop\.estimated_arrival_offset_seconds\)-anchorOffset\):0/);
  // The old formula counted down from departure and clamped at zero; it must not return.
  assert.doesNotMatch(server, /Math\.max\(0,Math\.ceil\(\(Date\.parse\(text\(trip\.data\.started_at\)\)\+numberValue\(tripStop\.estimated_arrival_offset_seconds\)/);
});

test('an expired estimate with stops still ahead reports unknown, not arrival', () => {
  // Reporting 0 while the bus is several stops away would read as "almost there".
  assert.match(server, /const eta=rawEta===null\?null:rawEta>0\?rawEta:\(stopsAway\|\|0\)>0\?null:0/);
  // The interface must not claim arrival from a number alone.
  assert.match(parentHome, /typeof passenger\?\.etaMinutes === 'number' && passenger\.etaMinutes <= 5 && \(passenger\.stopsAway \?\? 0\) === 0 \? t\('almostThere'\)/);
  // An active trip with an unknown estimate must not fall through to "not running".
  assert.match(parentHome, /\{data\.trip \? <div className="parent-eta">/);
  assert.match(parentHome, /t\('etaUnknown'\)/);
});

test('a parent learns how far away the bus is, without learning about other stops', () => {
  // Stops still to be served before this parent's own stop.
  assert.match(server, /const stopsAway=tripStop\?progressStops\.filter\(\(item\)=>numberValue\(item\.sequence\)<mySequence&&!\['COMPLETED','SKIPPED'\]\.includes\(text\(item\.status\)\)\)\.length:null/);
  // The progress query is server-side only: it selects no address, label or passenger, and
  // only the count reaches the parent.
  assert.match(server, /db\.from\('bus_app_trip_stops'\)\.select\('sequence,status,completed_at,estimated_arrival_offset_seconds'\)\.eq\('trip_id',trip\.data\.id\)\.order\('sequence'\)/);
  for (const forbidden of [/progressStops[^;]{0,120}display_address/, /progressStops[^;]{0,120}source_stop_id/]) {
    assert.doesNotMatch(server, forbidden);
  }
});

test('serving a stop pushes a realtime pulse to the affected parents', () => {
  // Previously only GPS updates pulsed parents, so with location off a parent saw nothing
  // until the next poll, even as the bus worked through the route.
  const handler = server.match(/app\.post\('\/trips\/:tripId\/stops\/:tripStopId'[\s\S]*?\}catch\(error\)\{return handleError\(c,error\);\}\}\);/)?.[0] || '';
  assert.ok(handler);
  assert.match(handler, /\['APPROACH','COMPLETE','SKIP'\]\.includes\(parsed\.data\.action\)/);
  assert.match(handler, /parentRecipientsForPassengers/);
  assert.match(handler, /event_type:'STOP_PROGRESS'/);
  // The pulse is best-effort: a failure here must not undo a completed stop.
  assert.match(handler, /catch\(reason\)\{console\.error\('\[bus-app\] parent stop pulse failed after a successful stop update',reason\);\}/);
  // The parent client already listens for these rows.
  assert.match(parentHome, /table: 'bus_app_parent_trip_updates', filter: `user_id=eq\.\$\{userData\.user\.id\}`/);
});

test('Edge sources are syntactically valid TypeScript', () => {
  for (const [name, source] of [['index.ts', server], ['schemas.ts', schemas], ['routing.ts', routing], ['notifications.ts', notifications], ['media-index.ts', media], ['image-core.ts', mediaImage], ['image.ts', mediaRuntime]]) {
    const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, reportDiagnostics: true, fileName: name });
    const errors = (output.diagnostics || []).filter((item) => item.category === ts.DiagnosticCategory.Error);
    assert.deepEqual(errors.map((item) => ts.flattenDiagnosticMessageText(item.messageText, '\n')), []);
  }
});
