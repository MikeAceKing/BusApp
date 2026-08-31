import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl, { type LngLatBoundsLike, type Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Crosshair, Maximize2 } from 'lucide-react';
import { mapAttribution, mapDefaultCenter, mapDefaultZoom, mapStyleUrl } from '../map-config';
import type { AvatarReference, GeometrySource, Locale } from '../types';
import { createT } from './Shared';

export type MapStopKind = 'start' | 'stop' | 'next' | 'own' | 'end';
export type MapStop = { id: string; longitude: number; latitude: number; label?: string | null; kind: MapStopKind; sequence?: number | null; completed?: boolean };
export type MapBus = { longitude: number; latitude: number; name: string; avatar?: AvatarReference | null };

const routeSourceId = 'busapp-route';
const routeLineId = 'busapp-route-line';
const routeCasingId = 'busapp-route-casing';

function stopElement(stop: MapStop): HTMLElement {
  const element = document.createElement('div');
  element.className = `map-marker map-marker--${stop.kind}${stop.completed ? ' map-marker--done' : ''}`;
  element.setAttribute('role', 'img');
  element.setAttribute('aria-label', stop.label || String(stop.sequence ?? ''));
  element.textContent = stop.kind === 'start' ? 'A' : stop.kind === 'end' ? 'B' : String(stop.sequence ?? '');
  return element;
}

function busElement(bus: MapBus): HTMLElement {
  const element = document.createElement('div');
  element.className = 'map-marker map-marker--bus';
  element.setAttribute('role', 'img');
  element.setAttribute('aria-label', bus.name);
  // The canonical bus identity is reused; there is no separate map iconography and no emoji.
  const source = bus.avatar?.photoUrl || (bus.avatar?.builtInAvatarId ? `/avatars/${bus.avatar.builtInAvatarId}.svg` : '/brand/busapp-mark.png');
  const image = document.createElement('img');
  image.src = source;
  image.alt = '';
  element.append(image);
  return element;
}

export function BusMap({ stops, bus, routeGeometry, geometrySource, locale, variant = 'staff' }: {
  stops: MapStop[];
  bus?: MapBus | null;
  routeGeometry?: { type: 'LineString'; coordinates: Array<[number, number]> } | null;
  geometrySource?: GeometrySource | null;
  locale: Locale;
  variant?: 'staff' | 'parent';
}) {
  const t = createT(locale);
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const busMarker = useRef<maplibregl.Marker | null>(null);
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  // A road polyline may only ever be drawn from geometry the provider actually returned.
  // An estimate or a waypoint chain shows stop positions on the real basemap, never a line.
  const roadGeometry = geometrySource === 'road' && routeGeometry && routeGeometry.coordinates.length >= 2 ? routeGeometry : null;

  const points = useCallback((): Array<[number, number]> => {
    const all: Array<[number, number]> = stops.map((stop) => [stop.longitude, stop.latitude]);
    if (bus) all.push([bus.longitude, bus.latitude]);
    if (roadGeometry) all.push(...roadGeometry.coordinates);
    return all.filter(([longitude, latitude]) => Number.isFinite(longitude) && Number.isFinite(latitude));
  }, [bus, roadGeometry, stops]);

  const fit = useCallback(() => {
    const all = points();
    if (!map.current || all.length === 0) return;
    if (all.length === 1) { map.current.easeTo({ center: all[0], zoom: 14, duration: 400 }); return; }
    const bounds = all.reduce((box, point) => box.extend(point), new maplibregl.LngLatBounds(all[0], all[0]));
    map.current.fitBounds(bounds as LngLatBoundsLike, { padding: 56, maxZoom: 15, duration: 400 });
  }, [points]);

  const centerBus = useCallback(() => {
    if (map.current && bus) map.current.easeTo({ center: [bus.longitude, bus.latitude], zoom: 14, duration: 400 });
  }, [bus]);

  useEffect(() => {
    if (!container.current || map.current) return;
    let instance: MapLibreMap;
    try {
      instance = new maplibregl.Map({
        container: container.current,
        style: mapStyleUrl,
        center: mapDefaultCenter,
        zoom: mapDefaultZoom,
        attributionControl: false,
        // The trip screen is used one-handed in a vehicle; rotation is a hazard, not a feature.
        pitchWithRotate: false,
        dragRotate: false,
        touchZoomRotate: true,
      });
    } catch { setUnavailable(true); return; }
    instance.touchZoomRotate.disableRotation();
    instance.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: mapAttribution }), 'bottom-right');
    instance.on('load', () => { setReady(true); setUnavailable(false); });
    // Tile failure must never take the trip runtime down with it.
    instance.on('error', (event) => { if (String((event as { error?: { message?: string } }).error?.message || '').length) setUnavailable(true); });
    map.current = instance;
    return () => { instance.remove(); map.current = null; setReady(false); };
  }, []);

  useEffect(() => {
    if (!map.current || !ready) return;
    for (const marker of markers.current) marker.remove();
    markers.current = stops
      .filter((stop) => Number.isFinite(stop.longitude) && Number.isFinite(stop.latitude))
      .map((stop) => new maplibregl.Marker({ element: stopElement(stop) }).setLngLat([stop.longitude, stop.latitude]).addTo(map.current!));
  }, [ready, stops]);

  useEffect(() => {
    if (!map.current || !ready) return;
    if (!bus) { busMarker.current?.remove(); busMarker.current = null; return; }
    if (!busMarker.current) busMarker.current = new maplibregl.Marker({ element: busElement(bus) }).setLngLat([bus.longitude, bus.latitude]).addTo(map.current);
    else busMarker.current.setLngLat([bus.longitude, bus.latitude]);
  }, [bus, ready]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready) return;
    const existing = instance.getSource(routeSourceId) as maplibregl.GeoJSONSource | undefined;
    if (!roadGeometry) {
      if (instance.getLayer(routeLineId)) instance.removeLayer(routeLineId);
      if (instance.getLayer(routeCasingId)) instance.removeLayer(routeCasingId);
      if (existing) instance.removeSource(routeSourceId);
      return;
    }
    const data = { type: 'Feature' as const, properties: {}, geometry: roadGeometry };
    if (existing) { existing.setData(data); return; }
    instance.addSource(routeSourceId, { type: 'geojson', data });
    instance.addLayer({ id: routeCasingId, type: 'line', source: routeSourceId, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#173f53', 'line-width': 8, 'line-opacity': .35 } });
    instance.addLayer({ id: routeLineId, type: 'line', source: routeSourceId, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffc83d', 'line-width': 5 } });
  }, [ready, roadGeometry]);

  useEffect(() => { if (ready) fit(); }, [fit, ready]);

  return <div className={`bus-map bus-map--${variant}`}>
    <div className="bus-map__canvas" ref={container} role="application" aria-label={t('mapLabel')} />
    {unavailable && <div className="bus-map__unavailable" role="status"><span>{t('mapUnavailableShort')}</span></div>}
    <div className="bus-map__controls">
      <button type="button" className="icon-button" onClick={fit} aria-label={t('fitRoute')} title={t('fitRoute')}><Maximize2 aria-hidden="true" /></button>
      {bus && <button type="button" className="icon-button" onClick={centerBus} aria-label={t('centerBus')} title={t('centerBus')}><Crosshair aria-hidden="true" /></button>}
    </div>
  </div>;
}
