import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, BusFront, Flag, LogOut, MapPin, Plus, Route, ShieldCheck, SwitchCamera, TriangleAlert, UserRound, UsersRound } from 'lucide-react';
import { api } from '../api';
import { busAppApiUrl, busAppPublicKey, supabase } from '../supabase';
import type { Locale, RoutePlan, SpaceHome, SpaceSummary } from '../types';
import { BottomNav, BusAvatar, BusyButton, ErrorBanner, PageHeader, StateCard, createT } from './Shared';
import { PassengerManager } from './PassengerManager';
import { RoutePlanner } from './RoutePlanner';
import { StopEditor } from './StopEditor';
import { TripRuntime } from './TripRuntime';

type BusTab = 'bus' | 'route' | 'passengers' | 'profile';

export function BusHome({ space, locale, onExit }: { space: SpaceSummary; locale: Locale; onExit: () => void }) {
  const t = createT(locale);
  const [home, setHome] = useState<SpaceHome | null>(null);
  const [tab, setTab] = useState<BusTab>('bus');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { setHome(await api<SpaceHome>(`/spaces/${space.id}/home`)); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('error')); }
  }, [space.id, t]);
  useEffect(() => { void load(); }, [load]);
  const passengerCount = useMemo(() => home?.stops.reduce((sum, stop) => sum + stop.expected_passenger_count, 0) || 0, [home]);

  async function start(plan: RoutePlan) {
    await api(`/spaces/${space.id}/trips/start`, { method: 'POST', idempotent: true, body: { routePlanId: plan.id } });
    await load();
  }

  if (!home && !error) return <main className="app-shell"><StateCard icon={BusFront} title={t('loading')} /></main>;
  if (!home) return <main className="app-shell"><ErrorBanner message={error} onRetry={load} label={t('retry')} /></main>;
  if (home.activeTrip) return <main className="app-shell runtime-shell"><PageHeader title={<span className="header-identity"><BusAvatar kind={home.bus?.avatar_key} />{home.bus?.name}</span>} action={<button className="icon-button" onClick={onExit} aria-label={t('switchMode')} title={t('switchMode')}><SwitchCamera aria-hidden="true" /></button>} /><TripRuntime spaceId={space.id} locale={locale} onFinished={load} /></main>;
  if (adding) return <main className="app-shell"><PageHeader title={<span className="header-identity"><BusAvatar kind={home.bus?.avatar_key} />{home.bus?.name}</span>} /><div className="page-content"><StopEditor spaceId={space.id} locale={locale} onCancel={() => setAdding(false)} onDone={async () => { setAdding(false); await load(); }} /></div></main>;

  const capacityExceeded = Boolean(home.bus && passengerCount > home.bus.capacity);
  const estimate = Boolean(home.routePlan?.provider_metadata.estimate || home.routePlan?.provider === 'local_heuristic');
  return <main className="app-shell bus-home">
    <PageHeader title={<span className="header-identity"><BusAvatar kind={home.bus?.avatar_key} />{home.bus?.name}</span>} action={<button className="icon-button" onClick={onExit} aria-label={t('switchMode')} title={t('switchMode')}><SwitchCamera aria-hidden="true" /></button>} />
    <div className="page-content">
      <ErrorBanner message={error} onRetry={load} label={t('retry')} />
      {tab === 'bus' && <>
        <section className="bus-hero">
          <div className="bus-identity-mark"><BusAvatar kind={home.bus?.avatar_key} size={54} /></div>
          <h1>{home.bus?.name}</h1>
          <div className="bus-stats"><span><strong>{home.stops.length}</strong>{t('addresses')}</span><span><strong>{passengerCount}</strong>{t('children')}</span></div>
          <div className={`route-state ${home.routePlan ? 'ready' : ''}`}>{home.routePlan ? <Route aria-hidden="true" /> : <MapPin aria-hidden="true" />}<span>{home.routePlan ? (estimate ? t('routeEstimate') : t('routeReady')) : t('routeMissing')}</span></div>
          {capacityExceeded && <div className="capacity-warning"><TriangleAlert aria-hidden="true" />{t('capacityWarning', { count: passengerCount, capacity: home.bus?.capacity || 0 })}</div>}
          <BusyButton className="primary-button jumbo button-with-icon" onClick={() => setTab('route')}><Route aria-hidden="true" />{home.routePlan ? t('viewRoute') : t('calculateRoute')}</BusyButton>
          <button className="add-stop-button button-with-icon" onClick={() => setAdding(true)}><Plus aria-hidden="true" />{t('addAddress')}</button>
          <details><summary>{t('moreOptions')}</summary><p className="button-with-icon"><MapPin aria-hidden="true" />{home.bus?.start_display_address}</p>{home.bus?.end_display_address && <p className="button-with-icon"><Flag aria-hidden="true" />{home.bus.end_display_address}</p>}</details>
        </section>
        <div className="stop-overview">{home.stops.map((stop) => <article key={stop.id}><MapPin aria-hidden="true" /><div><strong>{stop.label || stop.display_address.split(',')[0]}</strong><small>{stop.display_address}</small></div><b>{stop.expected_passenger_count}</b></article>)}</div>
      </>}
      {tab === 'route' && <RoutePlanner home={home} locale={locale} onChanged={load} onStart={start} />}
      {tab === 'passengers' && <PassengerManager home={home} locale={locale} onChanged={load} />}
      {tab === 'profile' && <Profile home={home} locale={locale} />}
    </div>
    <BottomNav items={[
      { key: 'bus', icon: BusFront, label: t('bus'), active: tab === 'bus', onClick: () => setTab('bus') },
      { key: 'route', icon: Route, label: t('route'), active: tab === 'route', onClick: () => setTab('route') },
      { key: 'passengers', icon: UsersRound, label: t('passengers'), active: tab === 'passengers', onClick: () => setTab('passengers') },
      { key: 'profile', icon: UserRound, label: t('profile'), active: tab === 'profile', onClick: () => setTab('profile') },
    ]} />
  </main>;
}

function Profile({ home, locale }: { home: SpaceHome; locale: Locale }) {
  const t = createT(locale);
  const [push, setPush] = useState(typeof Notification !== 'undefined' && Notification.permission === 'granted');
  const [error, setError] = useState('');
  async function enable() {
    try {
      if (typeof Notification === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error(t('error'));
      const config = await fetch(`${busAppApiUrl}/public-config`, { headers: { apikey: busAppPublicKey } }).then((response) => response.json()) as { webPushPublicKey: string | null };
      if (!config.webPushPublicKey) throw new Error(t('error'));
      const registration = await navigator.serviceWorker.ready;
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;
      const normalized = config.webPushPublicKey.replace(/-/g, '+').replace(/_/g, '/');
      const bytes = Uint8Array.from(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')), (char) => char.charCodeAt(0));
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
      await api('/push/subscribe', { method: 'POST', body: subscription.toJSON() });
      setPush(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('error')); }
  }
  return <section className="profile-page">
    <StateCard icon={BusFront} title={home.space.name} body={`${home.members.length} ${t('members')} · ${home.space.default_language.toUpperCase()}`} />
    <ErrorBanner message={error} />
    <button className="secondary-button jumbo button-with-icon" onClick={enable}><Bell aria-hidden="true" />{push ? t('pushEnabled') : t('enablePush')}</button>
    <aside className="privacy-note"><ShieldCheck aria-hidden="true" /><span><strong>{t('privacyTitle')}</strong><small>{t('privacyBody')}</small></span></aside>
    <button className="danger-link logout-button button-with-icon" onClick={() => supabase.auth.signOut()}><LogOut aria-hidden="true" />{t('logout')}</button>
  </section>;
}
