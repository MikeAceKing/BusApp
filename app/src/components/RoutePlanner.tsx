import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Clock3, GripVertical, MapPinned, Play, RotateCcw, Route as RouteIcon, Signpost, WandSparkles } from 'lucide-react';
import { api } from '../api';
import type { Locale, RoutePlan, SpaceHome, Stop } from '../types';
import { AddressText, BusyButton, CountLabel, ErrorBanner, FriendlyRouteIllustration, HonestMapState, createT } from './Shared';

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
  return <section className="route-page">
    <header className="section-heading"><div><small>{home.space.name}</small><h1>{t('route')}</h1></div>{plan && <RouteIcon className="section-heading__icon" aria-hidden="true" />}</header>

    {!plan && <section className="route-empty"><FriendlyRouteIllustration /><div><h2>{t('routeMissing')}</h2><p>{t('routeMissingHelp')}</p></div></section>}
    {plan && <section className={`route-status-card ${estimate ? 'route-status-card--estimate' : 'route-status-card--ready'}`}><RouteIcon aria-hidden="true" /><div><h2>{estimate ? t('routeEstimate') : t('realRoute')}</h2><p>{estimate ? t('estimated') : t('routeReady')}</p></div></section>}
    {plan && !estimate && plan.provider_metadata.geometrySource !== 'road' && <HonestMapState title={t('mapUnavailable')} body={t('mapUnavailableBody')} />}

    {plan && <div className={`route-summary ${estimate ? 'route-summary--estimate' : ''}`}>
      <div className="route-stat route-stat--distance"><Signpost aria-hidden="true" /><strong>{estimate ? '± ' : ''}{(plan.distance_meters / 1000).toFixed(1)} km</strong><small>{t('kilometers')}</small></div>
      <div className="route-stat route-stat--duration"><Clock3 aria-hidden="true" /><strong>{estimate ? '± ' : ''}{Math.max(1, Math.round(plan.duration_seconds / 60))} min</strong><small>{t('minutes')}</small></div>
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
