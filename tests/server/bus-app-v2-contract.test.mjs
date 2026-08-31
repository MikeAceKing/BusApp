import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const foundation = readFileSync('supabase/migrations/20260830220000_bus_app_v2_neutral_foundation.sql', 'utf8');
const speedPatch = readFileSync('supabase/migrations/20260831003000_bus_app_v2_location_event_speed.sql', 'utf8');
const avatarPatch = readFileSync('supabase/migrations/20260831013000_bus_app_v2_avatar_styles.sql', 'utf8');
const server = readFileSync('supabase/functions/bus-app/index.ts', 'utf8');
const schemas = readFileSync('supabase/functions/bus-app/schemas.ts', 'utf8');
const routing = readFileSync('supabase/functions/bus-app/routing.ts', 'utf8');
const notifications = readFileSync('supabase/functions/bus-app/notifications.ts', 'utf8');
const app = readFileSync('app/src/App.tsx', 'utf8');
const parentUi = readFileSync('app/src/components/ParentCode.tsx', 'utf8');

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

test('Edge sources are syntactically valid TypeScript', () => {
  for (const [name, source] of [['index.ts', server], ['schemas.ts', schemas], ['routing.ts', routing], ['notifications.ts', notifications]]) {
    const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, reportDiagnostics: true, fileName: name });
    const errors = (output.diagnostics || []).filter((item) => item.category === ts.DiagnosticCategory.Error);
    assert.deepEqual(errors.map((item) => ts.flattenDiagnosticMessageText(item.messageText, '\n')), []);
  }
});
