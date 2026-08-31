import { useCallback, useEffect, useRef, useState } from 'react';
import { BusFront, CircleCheck, CircleX, MapPin, Navigation, Play, ShieldCheck, Square, Wifi, WifiOff } from 'lucide-react';
import { api } from '../api';
import type { Locale, TripPassenger, TripRuntimeResponse } from '../types';
import { BusyButton, ErrorBanner, InitialAvatar, createT } from './Shared';

const queueKey = 'bus-app-v2-pending-actions';
type Queued = { id: string; path: string; body: Record<string, unknown> };

export function TripRuntime({ spaceId, locale, onFinished }: { spaceId: string; locale: Locale; onFinished: () => Promise<void> }) {
  const t = createT(locale);
  const [data, setData] = useState<TripRuntimeResponse | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const [gps, setGps] = useState('');
  const lastGps = useRef(0);
  const load = useCallback(async () => { try { setData(await api<TripRuntimeResponse>(`/spaces/${spaceId}/trip`)); setError(''); } catch (reason) { setError(reason instanceof Error ? reason.message : t('error')); } }, [spaceId, t]);
  const flush = useCallback(async () => {
    const queued = JSON.parse(localStorage.getItem(queueKey) || '[]') as Queued[];
    const remaining: Queued[] = [];
    for (const item of queued) { try { await api(item.path, { method: 'POST', body: item.body, idempotencyKey: item.id }); } catch { remaining.push(item); } }
    localStorage.setItem(queueKey, JSON.stringify(remaining));
    if (!remaining.length) await load();
  }, [load]);
  useEffect(() => {
    void load(); const timer = setInterval(load, 15_000);
    const up = () => { setOnline(true); void flush(); }; const down = () => setOnline(false);
    addEventListener('online', up); addEventListener('offline', down);
    return () => { clearInterval(timer); removeEventListener('online', up); removeEventListener('offline', down); };
  }, [flush, load]);
  const trip = data?.trip;
  const canDrive = data?.role === 'OWNER' || data?.role === 'DRIVER';
  const canAttend = data?.role === 'OWNER' || data?.role === 'ATTENDANT';
  useEffect(() => {
    if (!trip || !canDrive || !trip.driver_session_id || !['BOARDING', 'IN_TRANSIT'].includes(trip.status) || !navigator.geolocation) return;
    const watch = navigator.geolocation.watchPosition((position) => {
      if (Date.now() - lastGps.current < 12_000) return;
      lastGps.current = Date.now(); setGps('');
      void api(`/trips/${trip.id}/location`, { method: 'POST', body: { driverSessionId: trip.driver_session_id, latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyMeters: position.coords.accuracy, speedMps: position.coords.speed, capturedAt: new Date(position.timestamp).toISOString() } }).catch((reason: Error) => setGps(reason.message));
    }, () => setGps(t('gpsDenied')), { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 });
    return () => navigator.geolocation.clearWatch(watch);
  }, [canDrive, t, trip]);

  async function action(path: string, body: Record<string, unknown>, key: string, queueable = false) {
    setBusy(key); setError('');
    const queued = queueable ? { id: crypto.randomUUID(), path, body } : null;
    if (queued) { const all = JSON.parse(localStorage.getItem(queueKey) || '[]') as Queued[]; all.push(queued); localStorage.setItem(queueKey, JSON.stringify(all)); if (!online) { setBusy(''); return; } }
    try {
      await api(path, { method: 'POST', body, ...(queued ? { idempotencyKey: queued.id } : { idempotent: true }) });
      if (queued) { const all = JSON.parse(localStorage.getItem(queueKey) || '[]') as Queued[]; localStorage.setItem(queueKey, JSON.stringify(all.filter((item) => item.id !== queued.id))); }
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('error')); }
    finally { setBusy(''); }
  }

  if (!trip) return <section className="trip-runtime"><p>{t('noActiveTrip')}</p><button className="primary-button" onClick={onFinished}>{t('back')}</button></section>;
  return <section className="trip-runtime">
    <div className={`runtime-connection ${online ? 'online' : 'offline'}`}>{online ? <Wifi aria-hidden="true" /> : <WifiOff aria-hidden="true" />}<span>{online ? t('gpsActive') : t('offline')}</span></div>
    <ErrorBanner message={error} />{gps && <div className="warning-banner"><Navigation aria-hidden="true" />{gps}</div>}
    <TripProgress stops={trip.stops} label={t('tripProgress')} />
    <header className="next-stop-card"><small>{t('nextStop')}</small><h1>{trip.nextStop?.display_address || '—'}</h1><div><strong>{trip.nextStop?.expected_passenger_count || 0}</strong><span>{t('expectedAtStop')}</span></div></header>
    {canAttend && <div className="runtime-passengers">{trip.passengers.map((passenger) => <PassengerAttendance key={passenger.passenger_id} passenger={passenger} disabled={Boolean(busy)} locale={locale} onStatus={(status) => action(`/trips/${trip.id}/attendance`, { passengerId: passenger.passenger_id, status, expectedVersion: passenger.version }, passenger.passenger_id, true)} />)}</div>}
    {trip.nextStop && <div className="stop-actions"><BusyButton busy={busy === 'approach'} onClick={() => action(`/trips/${trip.id}/stops/${trip.nextStop!.id}`, { action: 'APPROACH' }, 'approach')}><Navigation aria-hidden="true" />{t('approaching')}</BusyButton><BusyButton busy={busy === 'arrive-stop'} onClick={() => action(`/trips/${trip.id}/stops/${trip.nextStop!.id}`, { action: trip.nextStop!.status === 'AT_STOP' ? 'COMPLETE' : 'ARRIVE' }, 'arrive-stop')}>{trip.nextStop.status === 'AT_STOP' ? <CircleCheck aria-hidden="true" /> : <MapPin aria-hidden="true" />}{trip.nextStop.status === 'AT_STOP' ? t('stopComplete') : t('arrive')}</BusyButton></div>}
    <div className="trip-main-action">
      {trip.status === 'BOARDING' && <BusyButton busy={busy === 'transition'} className="start-button jumbo button-with-icon" onClick={() => action(`/trips/${trip.id}/transition`, { transition: 'START' }, 'transition')}><Play aria-hidden="true" />{t('startDriving')}</BusyButton>}
      {trip.status === 'IN_TRANSIT' && !trip.nextStop && <BusyButton busy={busy === 'transition'} className="primary-button jumbo" onClick={() => action(`/trips/${trip.id}/transition`, { transition: 'ARRIVE' }, 'transition')}>{t('arrive')}</BusyButton>}
      {trip.status === 'ARRIVED' && <BusyButton busy={busy === 'transition'} className="primary-button jumbo button-with-icon" onClick={async () => { await action(`/trips/${trip.id}/transition`, { transition: 'COMPLETE' }, 'transition'); await onFinished(); }}><Square aria-hidden="true" />{t('complete')}</BusyButton>}
      <button className="danger-link" onClick={async () => { if (confirm(t('cancel'))) { await action(`/trips/${trip.id}/transition`, { transition: 'CANCEL' }, 'cancel'); await onFinished(); } }}>{t('cancel')}</button>
    </div>
    <p className="safety-copy"><ShieldCheck aria-hidden="true" />{t('driverSafety')}</p>
  </section>;
}

function TripProgress({ stops, label }: { stops: NonNullable<TripRuntimeResponse['trip']>['stops']; label: string }) {
  return <section className="trip-progress" aria-label={label}><BusFront aria-hidden="true" /><div>{stops.map((stop) => <span key={stop.id} className={`trip-progress__stop trip-progress__stop--${stop.status.toLowerCase()}`} title={stop.display_address}><i /><small>{stop.sequence}</small></span>)}</div></section>;
}

function PassengerAttendance({ passenger, disabled, locale, onStatus }: { passenger: TripPassenger; disabled: boolean; locale: Locale; onStatus: (status: 'BOARDED' | 'MISSED' | 'DROPPED_OFF') => void }) {
  const t = createT(locale);
  return <article><InitialAvatar name={passenger.display_name_snapshot} avatar={passenger.avatar_key_snapshot} /><span><strong>{passenger.display_name_snapshot}</strong><small>{passenger.status === 'BOARDED' ? t('onBus') : passenger.status === 'MISSED' ? t('missed') : passenger.status === 'DROPPED_OFF' ? t('dropped') : t('expected')}</small></span><div><button className="success" disabled={disabled || passenger.status === 'BOARDED'} onClick={() => onStatus('BOARDED')} aria-label={`${t('onBus')} ${passenger.display_name_snapshot}`}><CircleCheck aria-hidden="true" /></button><button className="danger" disabled={disabled || passenger.status !== 'EXPECTED'} onClick={() => onStatus('MISSED')} aria-label={`${t('missed')} ${passenger.display_name_snapshot}`}><CircleX aria-hidden="true" /></button>{passenger.status === 'BOARDED' && <button className="drop" disabled={disabled} onClick={() => onStatus('DROPPED_OFF')} aria-label={`${t('dropped')} ${passenger.display_name_snapshot}`}><MapPin aria-hidden="true" /></button>}</div></article>;
}
