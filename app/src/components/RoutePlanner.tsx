import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Clock3, GripVertical, MapPinned, Play, RotateCcw, Route as RouteIcon, Signpost, WandSparkles } from 'lucide-react';
import { api } from '../api';
import type { GeometrySource, Locale, RouteUxState, RoutePlan, SpaceHome, Stop } from '../types';
import { AddressText, BusyButton, CountLabel, ErrorBanner, FriendlyRouteIllustration, createT } from './Shared';
import { LazyBusMap, type MapStop } from './LazyBusMap';

export function RoutePlanner({ home, locale, onChanged, onStart }: { home: SpaceHome; locale: Locale; onChanged: () => Promise<void>; onStart: (plan: RoutePlan) => Promise<void> }) {
  const t = createT(locale);
  const [manual, setManual] = useState(false);
  const [order, setOrder] = useState<string[]>(home.stops.map((stop) => stop.id));
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [drag, setDrag] = useState<string | null>(null);
  useEffect(() => setOrder(home.stops.map((stop) => stop.id)), [home.stops]);
  const byId = new Map(home.stops.map((stop) => [stop.id, stop]));

  function move(id: string, direction: number) {
    const index = order.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
  }

  async function calculate() {
    setBusy('route');
    setError('');
    try {
      await api(`/spaces/${home.space.id}/routes/optimize`, { method: 'POST', idempotent: true, body: { mode: manual ? 'MANUAL' : 'AUTOMATIC', ...(manual ? { stopIds: order } : {}), roundTrip: false } });
      await onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('routeFailed')); }
    finally { setBusy(''); }
  }

  const plan = home.routePlan;
  const estimate = Boolean(plan?.provider_metadata.estimate || plan?.provider === 'local_heuristic');
  const orderedIds = manual ? order : (plan?.stops.map((stop) => stop.stop_id) || order);
  // The geometry source, not the presence of a plan, decides what may be drawn.
  const geometrySource: GeometrySource = plan?.provider_metadata.geometrySource === 'road' ? 'road' : plan?.provider_metadata.geometrySource === 'waypoints' ? 'waypoints' : 'estimate';
  const uxState: RouteUxState = busy === 'route' ? 'CALCULATING' : error ? 'PROVIDER_FAILED' : !plan ? 'NOT_CALCULATED' : geometrySource === 'road' ? 'ROAD_ROUTE_READY' : 'ESTIMATE_READY';
  // Real stop coordinates on a real basemap are honest even while the route is an estimate.
  const orderedMapStops: MapStop[] = [];
  orderedIds.forEach((id, index) => {
    const stop = byId.get(id);
    if (stop) orderedMapStops.push({ id, longitude: stop.longitude, latitude: stop.latitude, label: stop.display_address, kind: 'stop', sequence: index + 1 });
  });
  const mapStops: MapStop[] = [
    ...(home.bus && Number.isFinite(home.bus.start_latitude) ? [{ id: 'start', longitude: home.bus.start_longitude, latitude: home.bus.start_latitude, label: home.bus.start_display_address, kind: 'start' as const }] : []),
    ...orderedMapStops,
    ...(home.bus?.end_latitude != null ? [{ id: 'end', longitude: Number(home.bus.end_longitude), latitude: Number(home.bus.end_latitude), label: home.bus.end_display_address, kind: 'end' as const }] : []),
  ];
  return <section className="route-page">
    <header className="section-heading"><div><small>{home.bus?.name || home.space.name}</small><h1>{t('route')}</h1></div>{plan && <RouteIcon className="section-heading__icon" aria-hidden="true" />}</header>

    {uxState === 'NOT_CALCULATED' && <section className="route-empty"><FriendlyRouteIllustration /><div><h2>{t('routeMissing')}</h2><p>{t('routeMissingHelp')}</p></div></section>}
    {uxState === 'CALCULATING' && <section className="route-status-card route-status-card--calculating" role="status"><RouteIcon aria-hidden="true" /><div><h2>{t('routeCalculating')}</h2></div></section>}
    {plan && uxState !== 'CALCULATING' && <section className={`route-status-card ${geometrySource === 'road' ? 'route-status-card--ready' : 'route-status-card--estimate'}`}><RouteIcon aria-hidden="true" /><div><h2>{geometrySource === 'road' ? t('realRouteReady') : t('routeEstimate')}</h2><p>{geometrySource === 'road' ? t('routeReady') : t('estimated')}</p></div></section>}
    {plan?.provider_metadata.fallbackReason && <p className="route-fallback-note" role="status">{t('routeProviderFailed')}</p>}
    {mapStops.length > 0 && <LazyBusMap stops={mapStops} routeGeometry={geometrySource === 'road' ? plan?.route_geometry ?? null : null} geometrySource={geometrySource} locale={locale} />}

    {plan && <div className={`route-summary ${geometrySource === 'road' ? '' : 'route-summary--estimate'}`}>
      <div className="route-stat route-stat--distance"><Signpost aria-hidden="true" /><strong>{geometrySource === 'road' ? '' : '± '}{(plan.distance_meters / 1000).toFixed(1)} km</strong><small>{t('kilometers')}</small></div>
      <div className="route-stat route-stat--duration"><Clock3 aria-hidden="true" /><strong>{geometrySource === 'road' ? '' : '± '}{Math.max(1, Math.round(plan.duration_seconds / 60))} min</strong><small>{t('minutes')}</small></div>
      <div className="route-stat route-stat--stops"><MapPinned aria-hidden="true" /><strong>{plan.stops.length}</strong><small>{plan.stops.length === 1 ? t('stopOne') : t('stopMany')}</small></div>
    </div>}
    <ErrorBanner message={error} />
    {error && <div className="failure-actions"><button className="secondary-button button-with-icon" onClick={calculate}><RotateCcw aria-hidden="true" />{t('tryAgain')}</button><button className="secondary-button" onClick={() => setManual(true)}>{t('manualChoice')}</button></div>}

    <div className="route-mode"><button className={!manual ? 'active' : ''} onClick={() => setManual(false)}><WandSparkles aria-hidden="true" />{t('automaticRoute')}</button><button className={manual ? 'active' : ''} onClick={() => setManual(true)}><GripVertical aria-hidden="true" />{t('manualOrder')}</button></div>
    <div className="route-stop-list">{orderedIds.map((id, index) => {
      const stop = byId.get(id) as Stop | undefined;
      if (!stop) return null;
      return <article key={id} draggable={manual} onDragStart={() => setDrag(id)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (!drag || drag === id) return; const next = order.filter((item) => item !== drag); next.splice(next.indexOf(id), 0, drag); setOrder(next); setDrag(null); }}>
        <b>{index + 1}</b><span><AddressText address={stop.display_address} label={stop.label} compact /><small className="route-stop-passengers"><CountLabel count={stop.expected_passenger_count} one={t('passengerOne')} many={t('passengerMany')} /></small></span>
        {manual && <div><button aria-label={`${t('moveUp')} ${stop.display_address}`} title={t('moveUp')} onClick={() => move(id, -1)}><ArrowUp aria-hidden="true" /></button><button aria-label={`${t('moveDown')} ${stop.display_address}`} title={t('moveDown')} onClick={() => move(id, 1)}><ArrowDown aria-hidden="true" /></button></div>}
      </article>;
    })}</div>
    {manual && <p className="muted">{t('dragHint')}</p>}
    <BusyButton busy={busy === 'route'} className="secondary-button button-with-icon" disabled={!home.stops.length} onClick={calculate}><RouteIcon aria-hidden="true" />{plan ? t('recalculate') : t('calculateRoute')}</BusyButton>
    {plan && <BusyButton busy={busy === 'start'} className="start-button button-with-icon" onClick={async () => { setBusy('start'); setError(''); try { await onStart(plan); } catch (reason) { setError(reason instanceof Error ? reason.message : t('error')); } finally { setBusy(''); } }}><Play aria-hidden="true" />{t('startTrip')}</BusyButton>}
  </section>;
}
