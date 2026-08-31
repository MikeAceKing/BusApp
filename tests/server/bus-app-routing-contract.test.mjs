import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const routing = readFileSync('supabase/functions/bus-app/routing.ts', 'utf8');
const server = readFileSync('supabase/functions/bus-app/index.ts', 'utf8');
const usagePatch = readFileSync('supabase/migrations/20260831140000_bus_app_routing_provider_usage.sql', 'utf8');
const deselectFix = readFileSync('supabase/migrations/20260831150000_bus_app_route_plan_deselect_fix.sql', 'utf8');
const appRoot = existsSync('sites/busapp/src') ? 'sites/busapp/src' : 'app/src';
const mapConfig = readFileSync(`${appRoot}/map-config.ts`, 'utf8');
const busMap = readFileSync(`${appRoot}/components/BusMap.tsx`, 'utf8');
const routePlanner = readFileSync(`${appRoot}/components/RoutePlanner.tsx`, 'utf8');
const parentHome = readFileSync(`${appRoot}/components/ParentBusHome.tsx`, 'utf8');

test('the routing provider stays an abstraction with declared capabilities', () => {
  assert.match(routing, /export type RoutingProviderName = 'local' \| 'openrouteservice' \| 'osrm' \| 'vroom'/);
  assert.match(routing, /export type RoutingProviderCapabilities = \{[\s\S]*maxWaypoints: number \| null;[\s\S]*supportsOptimization: boolean;[\s\S]*supportsMatrix: boolean;[\s\S]*supportsRoadGeometry: boolean;/);
  // The existing local heuristic remains the resilience layer and is never deleted.
  assert.match(routing, /provider: 'local_heuristic'/);
  assert.match(routing, /nearest_neighbor_2opt/);
});

test('openrouteservice uses current official endpoints and a server-side key', () => {
  // api.openrouteservice.org was deprecated 2026-04-28 and shuts down 2026-09-28.
  assert.match(routing, /'https:\/\/api\.heigit\.org'/);
  assert.doesNotMatch(routing.replace(/\/\/.*$/gm, ''), /api\.openrouteservice\.org/);
  assert.match(routing, /'\/optimization'/);
  assert.match(routing, /`\/v2\/directions\/\$\{encodeURIComponent\(orsProfile\(\)\)\}\/geojson`/);
  assert.match(routing, /\/geocode\/search/);
  // The base URL stays configurable so infrastructure can move without a rewrite.
  assert.match(routing, /Deno\.env\.get\('OPENROUTESERVICE_BASE_URL'\)/);
  // The key is read from the server environment only, and never prefixed for a bundle.
  assert.match(routing, /Deno\.env\.get\('OPENROUTESERVICE_API_KEY'\)/);
  assert.doesNotMatch(routing, /VITE_OPENROUTESERVICE|import\.meta\.env/);
});

test('provider limits are detected before the request instead of truncating', () => {
  assert.match(routing, /const waypointCount = input\.stops\.length \+ 1 \+ \(input\.end \|\| input\.roundTrip \? 1 : 0\)/);
  assert.match(routing, /if \(capabilities\.maxWaypoints !== null && waypointCount > capabilities\.maxWaypoints\)/);
  assert.match(routing, /'ROUTE_TOO_MANY_STOPS'/);
  // Published openrouteservice limit, kept overridable rather than hardcoded blindly.
  assert.match(routing, /envInteger\('OPENROUTESERVICE_MAX_WAYPOINTS', 50\)/);
  // Nothing slices the stop list down to fit a provider.
  assert.doesNotMatch(routing, /stops\.slice\(0, ?(capabilities|maxWaypoints|50)/);
});

test('only real road geometry may be presented as a road route', () => {
  // A LineString is validated coordinate by coordinate before it can become road geometry.
  assert.match(routing, /function readLineString\(value: unknown\)/);
  assert.match(routing, /return coordinates\.length >= 2 \? \{ type: 'LineString', coordinates \} : null/);
  assert.match(routing, /if \(!geometry \|\| !Number\.isFinite\(distanceMeters\)[\s\S]*ROUTING_PROVIDER_RESPONSE_INVALID/);
  // Accuracy is derived from the geometry source, never set independently.
  assert.match(routing, /accuracy: geometrySource === 'road' \? 'ROAD' : 'ESTIMATE'/);
  // The local heuristic can only ever be an estimate.
  const local = routing.match(/function localOptimize\([\s\S]*?\n\}/)?.[0] || '';
  assert.ok(local);
  assert.match(local, /geometrySource: 'estimate'/);
  assert.doesNotMatch(local, /geometrySource: ?'road'/);
});

test('provider failure falls back to a labelled estimate, never a fake road route', () => {
  assert.match(routing, /export function classifyRoutingFailure/);
  for (const reason of ['PROVIDER_TIMEOUT', 'PROVIDER_UNAVAILABLE', 'RATE_LIMITED', 'INVALID_PROVIDER_RESPONSE']) {
    assert.match(routing, new RegExp(`'${reason}'`));
  }
  const dispatch = routing.match(/export async function optimizeRoute\([\s\S]*?\n\}/)?.[0] || '';
  assert.ok(dispatch);
  assert.match(dispatch, /const estimated = asOutcome\(localOptimize\(input\)\)/);
  assert.match(dispatch, /accuracy: 'ESTIMATE',\n      geometrySource: 'estimate',\n      fallbackReason,/);
  // A route the provider cannot serve is reported, not silently downgraded.
  assert.match(dispatch, /error\.code === 'ROUTE_TOO_MANY_STOPS'[\s\S]*throw error/);
  // The raw provider error never reaches the user.
  assert.doesNotMatch(dispatch, /message: ?error\.message|error instanceof Error \? error\.message/);
});

test('the external provider receives coordinates only, never a person', () => {
  const order = routing.match(/async function orsOrderStops\([\s\S]*?\n\}/)?.[0] || '';
  assert.ok(order);
  // Jobs are keyed by an ephemeral positional index, not a passenger or stop identifier.
  assert.match(order, /jobs: input\.stops\.map\(\(stop, index\) => \(\{ id: index \+ 1, location: \[stop\.longitude, stop\.latitude\] \}\)\)/);
  // Assert against code only: a comment naming what is excluded is not a leak.
  const orderCode = order.replace(/\/\/.*$/gm, '');
  const requestBody = orderCode.match(/const body = \{[\s\S]*?\n  \};/)?.[0] || '';
  assert.ok(requestBody);
  for (const forbidden of [/displayAddress/, /passenger/i, /parent/i, /user/i, /name/i]) {
    assert.doesNotMatch(requestBody, forbidden);
  }
  // The directions request carries coordinates and nothing else identifying.
  const directions = routing.match(/const directions = await orsRequest\([\s\S]*?\}\);/)?.[0] || '';
  assert.ok(directions);
  assert.match(directions, /coordinates: path\.map\(\(point\) => \[point\.longitude, point\.latitude\]\)/);
  assert.doesNotMatch(directions.replace(/\/\/.*$/gm, ''), /displayAddress|passenger|parent|\bname\b/i);
});

test('geocoding covers Belgium and France without unbounded worldwide search', () => {
  assert.match(routing, /export type CountryCode = 'BE' \| 'FR'/);
  assert.match(routing, /export function supportedCountries\(\): CountryCode\[\]/);
  assert.match(routing, /return allowed\.length \? \[\.\.\.new Set\(allowed\)\] : \['BE', 'FR'\]/);
  // Both providers are constrained to the supported countries.
  assert.match(routing, /url\.searchParams\.set\('countrycodes', supportedCountries\(\)\.map\(\(code\) => code\.toLowerCase\(\)\)\.join\(','\)\)/);
  assert.match(routing, /url\.searchParams\.set\('boundary\.country', supportedCountries\(\)\.join\(','\)\)/);
  // Structured fields, so the UI shows street + number and postcode + city.
  assert.match(routing, /function composeLabel/);
  assert.match(routing, /street\?: string \| null; houseNumber\?: string \| null; postalCode\?: string \| null; locality\?: string \| null/);
});

test('route calculation is permissioned, metered and closed to parents', () => {
  assert.match(server, /MANAGE_ROUTE:\{OWNER:true,DRIVER:true,ATTENDANT:false\}/);
  assert.match(server, /if\(!hasBusSpacePermission\(access,'MANAGE_ROUTE'\)\)throw new HttpError\(403,'ROUTE_FORBIDDEN'/);
  // A parent holds a grant, never a membership, so accessForSpace already excludes them.
  assert.doesNotMatch(server, /app\.(get|post)\('\/parent\/[a-z-]*rout/i);
  // Anonymous parent devices cannot burn the shared geocoding quota.
  assert.match(server, /if\(user\.is_anonymous\)throw new HttpError\(403,'GEOCODING_FORBIDDEN'/);
  assert.match(server, /consumeRoutingQuota\(user\.id,'geocode',60\)/);
  assert.match(server, /consumeRoutingQuota\(access\.user\.id,'route\.optimize',12\)/);
  // Metering lives in its own expiring table, not in the durable audit trail.
  assert.match(server, /from\('bus_app_routing_usage'\)/);
  assert.match(usagePatch, /create table public\.bus_app_routing_usage/);
  assert.match(usagePatch, /delete from public\.bus_app_routing_usage where expires_at <= now\(\)/);
  assert.match(usagePatch, /revoke all on public\.bus_app_routing_usage from anon, authenticated/);
  // Fallbacks are auditable.
  assert.match(server, /route\.fallbackReason\?'ROUTE_FALLBACK_USED':'ROUTE_CALCULATED'/);
});

test('no routing key is present in any built browser bundle', () => {
  const roots = ['sites/busapp/dist/assets', 'app/dist/assets'].filter((path) => existsSync(path));
  assert.ok(roots.length, 'a built bundle must exist for this scan to be meaningful');
  let scanned = 0;
  for (const root of roots) {
    for (const entry of readdirSync(root)) {
      if (!entry.endsWith('.js') && !entry.endsWith('.css')) continue;
      const bundle = readFileSync(join(root, entry), 'utf8');
      scanned += 1;
      for (const forbidden of [/OPENROUTESERVICE_API_KEY/, /api_key=/, /MAPBOX_ACCESS_TOKEN/, /SUPABASE_SERVICE_ROLE_KEY/]) {
        assert.doesNotMatch(bundle, forbidden, `${entry} must not contain a provider secret`);
      }
    }
  }
  assert.ok(scanned > 0, 'no bundle files were scanned');
});

test('the basemap is OpenFreeMap, keyless, attributed and replaceable', () => {
  assert.match(mapConfig, /https:\/\/tiles\.openfreemap\.org\/styles\/liberty/);
  assert.match(mapConfig, /export type MapStyleProvider = 'openfreemap' \| 'custom'/);
  assert.match(mapConfig, /VITE_MAP_STYLE_URL/);
  // Required attribution, kept in one place.
  assert.match(mapConfig, /openfreemap\.org[\s\S]*openmaptiles\.org[\s\S]*openstreetmap\.org\/copyright/);
  assert.match(busMap, /customAttribution: mapAttribution/);
  // A public style URL is not a secret, but no private key may ever appear here.
  assert.doesNotMatch(mapConfig, /api_key|apiKey|access_token|OPENROUTESERVICE/i);
  // Components never hardcode a style URL of their own.
  for (const source of [busMap, routePlanner, parentHome]) assert.doesNotMatch(source, /tiles\.openfreemap\.org/);
});

test('a road polyline is impossible unless the provider returned road geometry', () => {
  // The single gate in the renderer.
  assert.match(busMap, /const roadGeometry = geometrySource === 'road' && routeGeometry && routeGeometry\.coordinates\.length >= 2 \? routeGeometry : null/);
  // Layers are added only from roadGeometry, and removed when it is absent.
  assert.match(busMap, /if \(!roadGeometry\) \{[\s\S]*removeLayer\(routeLineId\)[\s\S]*removeLayer\(routeCasingId\)[\s\S]*removeSource\(routeSourceId\)/);
  assert.match(busMap, /instance\.addSource\(routeSourceId, \{ type: 'geojson', data \}\)/);
  const code = busMap.replace(/\/\/.*$/gm, '');
  // No other geometry may reach the line source.
  assert.doesNotMatch(code, /addSource\(routeSourceId[\s\S]{0,200}routeGeometry[^a-zA-Z]/);
  // The staff page passes geometry only when the source is road.
  assert.match(routePlanner, /routeGeometry=\{geometrySource === 'road' \? plan\?\.route_geometry \?\? null : null\}/);
  // The estimate keeps its approximation marker; a road route drops it.
  assert.match(routePlanner, /\{geometrySource === 'road' \? '' : '± '\}/);
});

test('the parent map carries only that parent, their stop and the bus', () => {
  const helper = server.match(/function parentRouteGeometry\([\s\S]*?\n\}/)?.[0] || '';
  assert.ok(helper);
  // Road geometry only, and trimmed to the span between the bus and this parent's stop.
  assert.match(helper, /if\(text\(metadata\.geometrySource\)!=='road'\)return null/);
  assert.match(helper, /const from=nearestVertexIndex\(coordinates,bus\.longitude,bus\.latitude\)/);
  assert.match(helper, /const to=nearestVertexIndex\(coordinates,stop\.longitude,stop\.latitude\)/);
  // The parent bus coordinate is rounded like every other parent-facing coordinate.
  assert.match(server, /busPoint=\{longitude:Math\.round\(numberValue\(live\.data\.longitude\)\*1000\)\/1000/);
  // Exactly one stop reaches a parent map: their own.
  assert.match(parentHome, /const parentMapStops: MapStop\[\] = profile\.map\?\.ownStop\n\s*\? \[\{ id: 'own'/);
  assert.doesNotMatch(parentHome, /stops\.map\(|passengers\.map\([\s\S]{0,80}kind: 'stop'/);
});

test('the route plan deselect fix is additive and explains itself', () => {
  assert.match(deselectFix, /alter table public\.bus_app_route_plans alter column selected_at drop not null/);
  // Non-destructive: nothing is deleted or rewritten.
  assert.doesNotMatch(deselectFix, /\bdrop table\b|\bdelete from\b|\btruncate\b/i);
  // The endpoint no longer swallows a failed deselect into a confusing conflict.
  assert.match(server, /const deselected=await db\.from\('bus_app_route_plans'\)\.update\(\{selected_at:null\}\)[\s\S]{0,120}if\(deselected\.error\)throw deselected\.error;/);
});
