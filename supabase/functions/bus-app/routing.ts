import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export type Point = { id: string; displayAddress: string; latitude: number; longitude: number; expectedPassengerCount: number };
export type GeocodeResult = { displayAddress: string; latitude: number; longitude: number; provider: string; reference: string | null };
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

export class RoutingError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
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
  if (query.length < 5 || query.length > 200) throw new RoutingError(400, 'ADDRESS_INVALID', 'Controleer het adres.');
  const provider = String(Deno.env.get('GEOCODING_PROVIDER') || 'nominatim').trim().toLowerCase();
  const queryHash = await sha256(`${provider}:${locale}:${query.toLocaleLowerCase('nl-BE')}`);
  const cached = await db.from('bus_app_geocode_cache').select('results,expires_at').eq('query_hash', queryHash).gt('expires_at', new Date().toISOString()).maybeSingle();
  if (cached.error) throw cached.error;
  if (cached.data?.results) return cached.data.results as GeocodeResult[];

  let results: GeocodeResult[];
  if (provider === 'mapbox') results = await geocodeMapbox(query, locale);
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
  url.searchParams.set('countrycodes', 'be');
  url.searchParams.set('limit', '5');
  url.searchParams.set('accept-language', locale);
  const response = await fetch(url, { headers: { 'user-agent': `Wexio-BusApp/2.0 (${contact})`, accept: 'application/json' }, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new RoutingError(503, 'GEOCODING_UNAVAILABLE', 'Adreszoeken is tijdelijk niet beschikbaar.');
  return rowArray(await response.json()).map((row) => ({
    displayAddress: String(row.display_name || '').slice(0, 300),
    latitude: Number(row.lat), longitude: Number(row.lon), provider: 'nominatim', reference: String(row.osm_type || '') + ':' + String(row.osm_id || ''),
  })).filter((item) => item.displayAddress && Number.isFinite(item.latitude) && Number.isFinite(item.longitude));
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

export async function optimizeRoute(input: RouteInput, mode: 'AUTOMATIC'|'MANUAL', manualOrder?: string[]): Promise<RouteResult> {
  if (mode === 'MANUAL') return localOptimize(input, manualOrder);
  const provider = String(Deno.env.get('ROUTING_PROVIDER') || 'local').trim().toLowerCase();
  if (provider === 'vroom') return vroomOptimize(input);
  if (provider === 'osrm') return osrmOptimize(input);
  if (provider === 'local') return localOptimize(input);
  throw new RoutingError(503, 'ROUTING_PROVIDER_INVALID', 'Routeberekening is tijdelijk niet beschikbaar.');
}
