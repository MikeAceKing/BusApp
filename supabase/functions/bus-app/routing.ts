import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export type Point = { id: string; displayAddress: string; latitude: number; longitude: number; expectedPassengerCount: number };
export type CountryCode = 'BE' | 'FR';
export type GeocodeResult = {
  displayAddress: string; latitude: number; longitude: number; provider: string; reference: string | null;
  street?: string | null; houseNumber?: string | null; postalCode?: string | null; locality?: string | null; countryCode?: CountryCode | null;
};

// Belgium and France only for this release. Widening is a deliberate configuration change,
// never an accident of an unbounded provider default.
export function supportedCountries(): CountryCode[] {
  const configured = String(Deno.env.get('GEOCODING_COUNTRIES') || 'BE,FR').split(',').map((value) => value.trim().toUpperCase());
  const allowed = configured.filter((value): value is CountryCode => value === 'BE' || value === 'FR');
  return allowed.length ? [...new Set(allowed)] : ['BE', 'FR'];
}

function normalizedCountry(value: unknown): CountryCode | null {
  const code = String(value || '').trim().toUpperCase();
  if (code === 'BE' || code === 'BEL') return 'BE';
  if (code === 'FR' || code === 'FRA') return 'FR';
  return null;
}

// street + house number, then postal code + locality — what a driver actually reads.
function composeLabel(parts: { street?: string | null; houseNumber?: string | null; postalCode?: string | null; locality?: string | null }, fallback: string): string {
  const line = [parts.street, parts.houseNumber].filter(Boolean).join(' ').trim();
  const place = [parts.postalCode, parts.locality].filter(Boolean).join(' ').trim();
  const composed = [line, place].filter(Boolean).join(', ');
  return (composed || fallback).slice(0, 300);
}
export type RouteInput = { start: Point; end: Point | null; stops: Point[]; roundTrip: boolean };
export type RouteResult = {
  provider: string;
  orderedStopIds: string[];
  distanceMeters: number;
  durationSeconds: number;
  arrivalOffsetsSeconds: Record<string, number>;
  geometry: { type: 'LineString'; coordinates: Array<[number, number]> };
  metadata: Record<string, unknown>;
};

export type RoutingProviderName = 'local' | 'openrouteservice' | 'osrm' | 'vroom';
export type RouteAccuracy = 'ROAD' | 'ESTIMATE';
export type GeometrySource = 'road' | 'waypoints' | 'estimate';
export type RoutingFallbackReason = 'PROVIDER_TIMEOUT' | 'PROVIDER_UNAVAILABLE' | 'RATE_LIMITED' | 'INVALID_PROVIDER_RESPONSE';

export type RoutingProviderCapabilities = {
  maxWaypoints: number | null;
  supportsOptimization: boolean;
  supportsMatrix: boolean;
  supportsRoadGeometry: boolean;
};

// Published openrouteservice limits (openrouteservice.org/restrictions): 50 directions
// waypoints and 50 optimization jobs per request. Kept configurable so an infrastructure
// change never requires an application rewrite.
function envInteger(name: string, fallback: number): number {
  const parsed = Number(Deno.env.get(name));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function providerCapabilities(provider: RoutingProviderName): RoutingProviderCapabilities {
  if (provider === 'openrouteservice') return { maxWaypoints: envInteger('OPENROUTESERVICE_MAX_WAYPOINTS', 50), supportsOptimization: true, supportsMatrix: true, supportsRoadGeometry: true };
  if (provider === 'osrm') return { maxWaypoints: envInteger('OSRM_MAX_WAYPOINTS', 100), supportsOptimization: true, supportsMatrix: true, supportsRoadGeometry: true };
  if (provider === 'vroom') return { maxWaypoints: envInteger('VROOM_MAX_WAYPOINTS', 100), supportsOptimization: true, supportsMatrix: false, supportsRoadGeometry: false };
  return { maxWaypoints: null, supportsOptimization: true, supportsMatrix: false, supportsRoadGeometry: false };
}

export function configuredProvider(): RoutingProviderName {
  const value = String(Deno.env.get('ROUTING_PROVIDER') || 'local').trim().toLowerCase();
  return value === 'openrouteservice' || value === 'osrm' || value === 'vroom' ? value : 'local';
}

export class RoutingError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

// Provider faults are classified for the audit log. The raw provider error is never
// surfaced to a user; the UI only learns that an estimate is being shown.
export function classifyRoutingFailure(error: unknown): RoutingFallbackReason {
  if (error instanceof DOMException && error.name === 'TimeoutError') return 'PROVIDER_TIMEOUT';
  if (error instanceof RoutingError) {
    if (error.status === 429) return 'RATE_LIMITED';
    if (error.code === 'ROUTING_PROVIDER_RESPONSE_INVALID') return 'INVALID_PROVIDER_RESPONSE';
    if (error.status === 503 || error.status === 504) return 'PROVIDER_UNAVAILABLE';
  }
  return 'PROVIDER_UNAVAILABLE';
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function rowArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : [];
}

export async function geocodeAddress(db: SupabaseClient, rawQuery: string, locale: 'nl'|'fr'): Promise<GeocodeResult[]> {
  const query = rawQuery.trim().replace(/\s+/g, ' ');
  if (query.length < 3 || query.length > 200) throw new RoutingError(400, 'ADDRESS_INVALID', 'Controleer het adres.');
  const provider = String(Deno.env.get('GEOCODING_PROVIDER') || 'nominatim').trim().toLowerCase();
  const queryHash = await sha256(`${provider}:${locale}:${query.toLocaleLowerCase('nl-BE')}`);
  const cached = await db.from('bus_app_geocode_cache').select('results,expires_at').eq('query_hash', queryHash).gt('expires_at', new Date().toISOString()).maybeSingle();
  if (cached.error) throw cached.error;
  if (cached.data?.results) return cached.data.results as GeocodeResult[];

  let results: GeocodeResult[];
  if (provider === 'openrouteservice') results = await geocodeOpenRouteService(query, locale);
  else if (provider === 'mapbox') results = await geocodeMapbox(query, locale);
  else if (provider === 'nominatim') {
    const recent = await db.from('bus_app_geocode_cache').select('created_at').eq('provider', 'nominatim').order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (recent.error) throw recent.error;
    if (recent.data && Date.now() - Date.parse(String(recent.data.created_at)) < 1_100) {
      throw new RoutingError(429, 'GEOCODING_BUSY', 'Even wachten en opnieuw proberen.');
    }
    results = await geocodeNominatim(query, locale);
  } else throw new RoutingError(503, 'GEOCODING_PROVIDER_INVALID', 'Adreszoeken is tijdelijk niet beschikbaar.');

  await db.from('bus_app_geocode_cache').upsert({
    query_hash: queryHash, provider, results,
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  });
  return results;
}

async function geocodeNominatim(query: string, locale: 'nl'|'fr'): Promise<GeocodeResult[]> {
  const contact = String(Deno.env.get('BUS_APP_GEOCODING_CONTACT') || 'admin@wexio.be').trim();
  const url = new URL(String(Deno.env.get('NOMINATIM_BASE_URL') || 'https://nominatim.openstreetmap.org/search'));
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('countrycodes', supportedCountries().map((code) => code.toLowerCase()).join(','));
  url.searchParams.set('limit', '5');
  url.searchParams.set('accept-language', locale);
  const response = await fetch(url, { headers: { 'user-agent': `Wexio-BusApp/2.0 (${contact})`, accept: 'application/json' }, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new RoutingError(503, 'GEOCODING_UNAVAILABLE', 'Adreszoeken is tijdelijk niet beschikbaar.');
  return rowArray(await response.json()).map((row) => {
    const address = (row.address && typeof row.address === 'object' ? row.address : {}) as Record<string, unknown>;
    const street = String(address.road || address.pedestrian || address.footway || '') || null;
    const houseNumber = String(address.house_number || '') || null;
    const postalCode = String(address.postcode || '') || null;
    const locality = String(address.city || address.town || address.village || address.municipality || '') || null;
    return {
      displayAddress: composeLabel({ street, houseNumber, postalCode, locality }, String(row.display_name || '')),
      latitude: Number(row.lat), longitude: Number(row.lon), provider: 'nominatim',
      reference: String(row.osm_type || '') + ':' + String(row.osm_id || ''),
      street, houseNumber, postalCode, locality, countryCode: normalizedCountry(address.country_code),
    };
  }).filter((item) => item.displayAddress && Number.isFinite(item.latitude) && Number.isFinite(item.longitude));
}

// openrouteservice runs Pelias. GET /geocode/search takes the key as a query parameter;
// the request is made from the Edge function so the key never reaches a browser.
async function geocodeOpenRouteService(query: string, locale: 'nl'|'fr'): Promise<GeocodeResult[]> {
  const key = String(Deno.env.get('OPENROUTESERVICE_API_KEY') || '').trim();
  if (!key) throw new RoutingError(503, 'GEOCODING_UNAVAILABLE', 'Adreszoeken is tijdelijk niet beschikbaar.');
  const url = new URL(`${orsBase()}/geocode/search`);
  url.searchParams.set('api_key', key);
  url.searchParams.set('text', query);
  url.searchParams.set('boundary.country', supportedCountries().join(','));
  url.searchParams.set('lang', locale);
  url.searchParams.set('size', '5');
  const response = await fetch(url, { headers: { accept: 'application/geo+json' }, signal: AbortSignal.timeout(8_000) });
  if (response.status === 429) throw new RoutingError(429, 'GEOCODING_BUSY', 'Even wachten en opnieuw proberen.');
  if (!response.ok) throw new RoutingError(503, 'GEOCODING_UNAVAILABLE', 'Adreszoeken is tijdelijk niet beschikbaar.');
  const payload = await response.json().catch(() => null) as { features?: Array<{ geometry?: { coordinates?: unknown }; properties?: Record<string, unknown> }> } | null;
  if (!payload || !Array.isArray(payload.features)) throw new RoutingError(502, 'GEOCODING_PROVIDER_RESPONSE_INVALID', 'Adreszoeken is tijdelijk niet beschikbaar.');
  return payload.features.map((feature) => {
    const properties = feature.properties || {};
    const coordinates = Array.isArray(feature.geometry?.coordinates) ? feature.geometry.coordinates as unknown[] : [];
    const street = String(properties.street || '') || null;
    const houseNumber = String(properties.housenumber || '') || null;
    const postalCode = String(properties.postalcode || '') || null;
    const locality = String(properties.locality || properties.localadmin || properties.county || '') || null;
    return {
      displayAddress: composeLabel({ street, houseNumber, postalCode, locality }, String(properties.label || '')),
      longitude: Number(coordinates[0]), latitude: Number(coordinates[1]),
      provider: 'openrouteservice', reference: String(properties.gid || '') || null,
      street, houseNumber, postalCode, locality, countryCode: normalizedCountry(properties.country_a),
    };
  }).filter((item) => item.displayAddress && Number.isFinite(item.latitude) && Number.isFinite(item.longitude) && item.countryCode !== null);
}

async function geocodeMapbox(query: string, locale: 'nl'|'fr'): Promise<GeocodeResult[]> {
  const token = String(Deno.env.get('MAPBOX_ACCESS_TOKEN') || '');
  if (!token) throw new RoutingError(503, 'GEOCODING_UNAVAILABLE', 'Adreszoeken is tijdelijk niet beschikbaar.');
  const url = new URL(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`);
  url.searchParams.set('access_token', token); url.searchParams.set('country', 'be'); url.searchParams.set('language', locale); url.searchParams.set('limit', '5');
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new RoutingError(503, 'GEOCODING_UNAVAILABLE', 'Adreszoeken is tijdelijk niet beschikbaar.');
  const payload = await response.json() as { features?: Array<{ id?: string; place_name?: string; center?: [number,number] }> };
  return (payload.features || []).map((feature) => ({ displayAddress: String(feature.place_name || '').slice(0,300), longitude: Number(feature.center?.[0]), latitude: Number(feature.center?.[1]), provider: 'mapbox', reference: feature.id || null })).filter((item) => item.displayAddress && Number.isFinite(item.latitude) && Number.isFinite(item.longitude));
}

function haversine(a: Point, b: Point): number {
  const rad = (value: number) => value * Math.PI / 180;
  const dLat = rad(b.latitude - a.latitude); const dLon = rad(b.longitude - a.longitude);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function pathDistance(start: Point, stops: Point[], end: Point | null, roundTrip: boolean): number {
  const path = [start, ...stops, ...(end ? [end] : roundTrip ? [start] : [])];
  return path.slice(1).reduce((sum, point, index) => sum + haversine(path[index], point), 0);
}

function twoOpt(start: Point, input: Point[], end: Point | null, roundTrip: boolean): Point[] {
  let result = [...input]; let improved = true; let passes = 0;
  while (improved && passes++ < 12) {
    improved = false;
    for (let i = 0; i < result.length - 1; i++) for (let j = i + 1; j < result.length; j++) {
      const candidate = [...result.slice(0,i), ...result.slice(i,j + 1).reverse(), ...result.slice(j + 1)];
      if (pathDistance(start, candidate, end, roundTrip) + 1 < pathDistance(start, result, end, roundTrip)) { result = candidate; improved = true; }
    }
  }
  return result;
}

function localOptimize(input: RouteInput, manualOrder?: string[]): RouteResult {
  let ordered: Point[];
  if (manualOrder) {
    const byId = new Map(input.stops.map((stop) => [stop.id, stop]));
    ordered = manualOrder.map((id) => byId.get(id)).filter((stop): stop is Point => Boolean(stop));
    if (ordered.length !== input.stops.length) throw new RoutingError(400, 'STOP_ORDER_INVALID', 'De haltevolgorde is niet volledig.');
  } else {
    const remaining = [...input.stops]; ordered = []; let current = input.start;
    while (remaining.length) { let best = 0; for (let index = 1; index < remaining.length; index++) if (haversine(current, remaining[index]) < haversine(current, remaining[best])) best = index; current = remaining.splice(best,1)[0]; ordered.push(current); }
    ordered = twoOpt(input.start, ordered, input.end, input.roundTrip);
  }
  const path = [input.start, ...ordered, ...(input.end ? [input.end] : input.roundTrip ? [input.start] : [])];
  let cumulative = 0; const offsets: Record<string,number> = {};
  for (let index = 1; index <= ordered.length; index++) { cumulative += Math.round(haversine(path[index - 1], path[index]) * 1.22); offsets[ordered[index - 1].id] = Math.round(cumulative / (32_000 / 3_600)); }
  const distance = Math.round(pathDistance(input.start, ordered, input.end, input.roundTrip) * 1.22);
  return { provider: 'local_heuristic', orderedStopIds: ordered.map((stop) => stop.id), distanceMeters: distance, durationSeconds: Math.round(distance / (32_000 / 3_600)), arrivalOffsetsSeconds: offsets, geometry: { type: 'LineString', coordinates: path.map((point) => [point.longitude, point.latitude]) }, metadata: { estimate: true, geometrySource: 'estimate', algorithm: manualOrder ? 'manual_snapshot' : 'nearest_neighbor_2opt' } };
}

async function osrmOptimize(input: RouteInput): Promise<RouteResult> {
  if (!input.end && !input.roundTrip) throw new RoutingError(422, 'ROUTING_OPEN_TRIP_UNSUPPORTED', 'Deze provider ondersteunt geen open route zonder eindpunt.');
  const points = [input.start, ...input.stops, ...(input.end ? [input.end] : [])];
  const coordinates = points.map((point) => `${point.longitude},${point.latitude}`).join(';');
  const url = new URL(`${String(Deno.env.get('OSRM_BASE_URL') || '').replace(/\/$/,'')}/trip/v1/driving/${coordinates}`);
  if (!url.origin || url.origin === 'null') throw new RoutingError(503, 'ROUTING_UNAVAILABLE', 'Routeberekening is tijdelijk niet beschikbaar.');
  url.searchParams.set('source','first'); url.searchParams.set('destination', input.end ? 'last' : 'any'); url.searchParams.set('roundtrip', String(input.roundTrip)); url.searchParams.set('geometries','geojson'); url.searchParams.set('overview','full');
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new RoutingError(503, 'ROUTING_UNAVAILABLE', 'Routeberekening is tijdelijk niet beschikbaar.');
  const payload = await response.json() as { code?: string; trips?: Array<{ distance?: number; duration?: number; geometry?: { type: 'LineString'; coordinates: Array<[number,number]> } }>; waypoints?: Array<{ waypoint_index?: number }> };
  if (payload.code !== 'Ok' || !payload.trips?.[0] || !payload.waypoints) throw new RoutingError(422, 'ROUTE_NOT_FOUND', 'Geen geldige route gevonden.');
  const stopWaypoints = payload.waypoints.slice(1, 1 + input.stops.length).map((waypoint,index) => ({ id: input.stops[index].id, order: Number(waypoint.waypoint_index) })).sort((a,b) => a.order - b.order);
  const ordered = stopWaypoints.map((item) => item.id); const duration = Math.round(Number(payload.trips[0].duration || 0)); const offsets: Record<string,number> = {};
  ordered.forEach((id,index) => { offsets[id] = Math.round(duration * ((index + 1) / (ordered.length + (input.end || input.roundTrip ? 1 : 0)))); });
  return { provider: 'osrm', orderedStopIds: ordered, distanceMeters: Math.round(Number(payload.trips[0].distance || 0)), durationSeconds: duration, arrivalOffsetsSeconds: offsets, geometry: payload.trips[0].geometry || { type:'LineString', coordinates: [] }, metadata: { estimate: false, geometrySource: payload.trips[0].geometry ? 'road' : 'waypoints' } };
}

async function vroomOptimize(input: RouteInput): Promise<RouteResult> {
  const endpoint = String(Deno.env.get('VROOM_BASE_URL') || '').replace(/\/$/,'');
  if (!endpoint) throw new RoutingError(503, 'ROUTING_UNAVAILABLE', 'Routeberekening is tijdelijk niet beschikbaar.');
  const body = { vehicles: [{ id: 1, start: [input.start.longitude,input.start.latitude], ...(input.end ? { end:[input.end.longitude,input.end.latitude] } : input.roundTrip ? { end:[input.start.longitude,input.start.latitude] } : {}) }], jobs: input.stops.map((stop,index) => ({ id:index + 1, location:[stop.longitude,stop.latitude], amount:[stop.expectedPassengerCount] })) };
  const response = await fetch(endpoint, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body), signal:AbortSignal.timeout(12_000) });
  if (!response.ok) throw new RoutingError(503, 'ROUTING_UNAVAILABLE', 'Routeberekening is tijdelijk niet beschikbaar.');
  const payload = await response.json() as { code?: number; summary?: { distance?: number; duration?: number }; routes?: Array<{ steps?: Array<{ type?: string; id?: number; arrival?: number }> }> };
  if (payload.code !== 0 || !payload.routes?.[0]) throw new RoutingError(422, 'ROUTE_NOT_FOUND', 'Geen geldige route gevonden.');
  const jobs = (payload.routes[0].steps || []).filter((step) => step.type === 'job' && Number.isInteger(step.id));
  const ordered = jobs.map((step) => input.stops[Number(step.id) - 1]?.id).filter(Boolean); const offsets: Record<string,number> = {};
  jobs.forEach((step) => { const id = input.stops[Number(step.id) - 1]?.id; if (id) offsets[id] = Number(step.arrival || 0); });
  const lookup = new Map(input.stops.map((stop) => [stop.id,stop])); const orderedPoints = ordered.map((id) => lookup.get(id)).filter((point): point is Point => Boolean(point));
  return { provider:'vroom', orderedStopIds:ordered, distanceMeters:Math.round(Number(payload.summary?.distance || 0)), durationSeconds:Math.round(Number(payload.summary?.duration || 0)), arrivalOffsetsSeconds:offsets, geometry:{ type:'LineString', coordinates:[input.start,...orderedPoints,...(input.end ? [input.end] : input.roundTrip ? [input.start] : [])].map((point) => [point.longitude,point.latitude]) }, metadata:{ estimate:false, geometrySource:'waypoints' } };
}

// --- openrouteservice / HeiGIT ---------------------------------------------------------
// Official endpoints (api.openrouteservice.org): POST /optimization for stop ordering
// (VROOM-backed) and POST /v2/directions/{profile}/geojson for real road geometry.
// The key is read from the server environment and never leaves the Edge function.
function orsBase(): string { return String(Deno.env.get('OPENROUTESERVICE_BASE_URL') || 'https://api.openrouteservice.org').replace(/\/$/, ''); }
function orsProfile(): string { return String(Deno.env.get('OPENROUTESERVICE_PROFILE') || 'driving-car').trim(); }

async function orsRequest(path: string, body: unknown): Promise<Record<string, unknown>> {
  const key = String(Deno.env.get('OPENROUTESERVICE_API_KEY') || '').trim();
  if (!key) throw new RoutingError(503, 'ROUTING_UNAVAILABLE', 'Routeberekening is tijdelijk niet beschikbaar.');
  const response = await fetch(`${orsBase()}${path}`, {
    method: 'POST',
    headers: { authorization: key, 'content-type': 'application/json', accept: 'application/json, application/geo+json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 429) throw new RoutingError(429, 'ROUTING_RATE_LIMITED', 'Routeberekening is tijdelijk niet beschikbaar.');
  if (!response.ok) throw new RoutingError(503, 'ROUTING_UNAVAILABLE', 'Routeberekening is tijdelijk niet beschikbaar.');
  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== 'object') throw new RoutingError(502, 'ROUTING_PROVIDER_RESPONSE_INVALID', 'Routeberekening is tijdelijk niet beschikbaar.');
  return payload as Record<string, unknown>;
}

// Only a LineString with at least two positions may ever be treated as road geometry.
function readLineString(value: unknown): { type: 'LineString'; coordinates: Array<[number, number]> } | null {
  const candidate = value as { type?: unknown; coordinates?: unknown } | null;
  if (!candidate || candidate.type !== 'LineString' || !Array.isArray(candidate.coordinates)) return null;
  const coordinates: Array<[number, number]> = [];
  for (const entry of candidate.coordinates) {
    if (!Array.isArray(entry) || entry.length < 2) return null;
    const longitude = Number(entry[0]); const latitude = Number(entry[1]);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) return null;
    coordinates.push([longitude, latitude]);
  }
  return coordinates.length >= 2 ? { type: 'LineString', coordinates } : null;
}

async function orsOrderStops(input: RouteInput): Promise<string[]> {
  if (!input.stops.length) return [];
  if (input.stops.length === 1) return [input.stops[0].id];
  // The provider receives coordinates and an opaque index only. No passenger, parent or
  // Bus Space identifier is ever sent to an external routing service.
  const body = {
    vehicles: [{
      id: 1,
      profile: orsProfile(),
      start: [input.start.longitude, input.start.latitude],
      ...(input.end ? { end: [input.end.longitude, input.end.latitude] } : input.roundTrip ? { end: [input.start.longitude, input.start.latitude] } : {}),
    }],
    jobs: input.stops.map((stop, index) => ({ id: index + 1, location: [stop.longitude, stop.latitude] })),
  };
  const payload = await orsRequest('/optimization', body);
  const routes = Array.isArray(payload.routes) ? payload.routes as Array<{ steps?: Array<{ type?: string; job?: number; id?: number }> }> : [];
  const steps = routes[0]?.steps || [];
  const ordered = steps
    .filter((step) => step.type === 'job')
    .map((step) => Number(step.job ?? step.id))
    .filter((index) => Number.isInteger(index) && index >= 1 && index <= input.stops.length)
    .map((index) => input.stops[index - 1].id);
  if (new Set(ordered).size !== input.stops.length) throw new RoutingError(502, 'ROUTING_PROVIDER_RESPONSE_INVALID', 'Routeberekening is tijdelijk niet beschikbaar.');
  return ordered;
}

async function openRouteServiceOptimize(input: RouteInput): Promise<RouteResult> {
  const capabilities = providerCapabilities('openrouteservice');
  const waypointCount = input.stops.length + 1 + (input.end || input.roundTrip ? 1 : 0);
  // Detected before the request. The route is never silently truncated to fit.
  if (capabilities.maxWaypoints !== null && waypointCount > capabilities.maxWaypoints) {
    throw new RoutingError(422, 'ROUTE_TOO_MANY_STOPS', 'Deze rit heeft te veel haltes voor de huidige routeprovider.');
  }
  const orderedIds = await orsOrderStops(input);
  const byId = new Map(input.stops.map((stop) => [stop.id, stop]));
  const orderedPoints = orderedIds.map((id) => byId.get(id)).filter((stop): stop is Point => Boolean(stop));
  const path = [input.start, ...orderedPoints, ...(input.end ? [input.end] : input.roundTrip ? [input.start] : [])];
  if (path.length < 2) throw new RoutingError(422, 'ROUTE_NOT_FOUND', 'Geen geldige route gevonden.');

  const directions = await orsRequest(`/v2/directions/${encodeURIComponent(orsProfile())}/geojson`, {
    coordinates: path.map((point) => [point.longitude, point.latitude]),
    instructions: false,
  });
  const features = Array.isArray(directions.features) ? directions.features as Array<{ geometry?: unknown; properties?: { summary?: { distance?: unknown; duration?: unknown }; segments?: Array<{ distance?: unknown; duration?: unknown }> } }> : [];
  const feature = features[0];
  const geometry = readLineString(feature?.geometry);
  const summary = feature?.properties?.summary;
  const distanceMeters = Math.round(Number(summary?.distance));
  const durationSeconds = Math.round(Number(summary?.duration));
  if (!geometry || !Number.isFinite(distanceMeters) || !Number.isFinite(durationSeconds) || distanceMeters <= 0) {
    throw new RoutingError(502, 'ROUTING_PROVIDER_RESPONSE_INVALID', 'Routeberekening is tijdelijk niet beschikbaar.');
  }
  // Arrival offsets come from real per-leg road durations, not a proportional guess.
  const segments = feature?.properties?.segments || [];
  const offsets: Record<string, number> = {};
  let cumulative = 0;
  orderedIds.forEach((id, index) => {
    cumulative += Math.round(Number(segments[index]?.duration) || 0);
    offsets[id] = cumulative;
  });
  return {
    provider: 'openrouteservice',
    orderedStopIds: orderedIds,
    distanceMeters,
    durationSeconds,
    arrivalOffsetsSeconds: offsets,
    geometry,
    metadata: { estimate: false, accuracy: 'ROAD', geometrySource: 'road', profile: orsProfile(), calculatedAt: new Date().toISOString() },
  };
}

export type RouteOutcome = RouteResult & { accuracy: RouteAccuracy; geometrySource: GeometrySource; fallbackReason?: RoutingFallbackReason };

function asOutcome(result: RouteResult): RouteOutcome {
  const source = String((result.metadata as Record<string, unknown>).geometrySource || 'estimate');
  const geometrySource: GeometrySource = source === 'road' ? 'road' : source === 'waypoints' ? 'waypoints' : 'estimate';
  return { ...result, geometrySource, accuracy: geometrySource === 'road' ? 'ROAD' : 'ESTIMATE' };
}

export async function optimizeRoute(input: RouteInput, mode: 'AUTOMATIC'|'MANUAL', manualOrder?: string[]): Promise<RouteOutcome> {
  if (mode === 'MANUAL') return asOutcome(localOptimize(input, manualOrder));
  const provider = configuredProvider();
  if (provider === 'local') return asOutcome(localOptimize(input));
  try {
    if (provider === 'openrouteservice') return asOutcome(await openRouteServiceOptimize(input));
    if (provider === 'osrm') return asOutcome(await osrmOptimize(input));
    return asOutcome(await vroomOptimize(input));
  } catch (error) {
    // A route the provider genuinely cannot serve is a real answer, not a fault to mask.
    if (error instanceof RoutingError && (error.code === 'ROUTE_TOO_MANY_STOPS' || error.code === 'ROUTING_OPEN_TRIP_UNSUPPORTED')) throw error;
    const fallbackReason = classifyRoutingFailure(error);
    console.error('[bus-app] routing provider failed', { provider, fallbackReason });
    const estimated = asOutcome(localOptimize(input));
    return {
      ...estimated,
      accuracy: 'ESTIMATE',
      geometrySource: 'estimate',
      fallbackReason,
      metadata: { ...estimated.metadata, estimate: true, accuracy: 'ESTIMATE', geometrySource: 'estimate', attemptedProvider: provider, fallbackReason },
    };
  }
}
