import { useCallback, useEffect, useState } from 'react';
import { Bell, BusFront, Circle, CircleCheck, Clock3, LogOut, MapPin, MapPinned, ShieldCheck, SwitchCamera, UserRound, UsersRound } from 'lucide-react';
import { api } from '../api';
import { supabase } from '../supabase';
import type { BusNotification, Locale, ParentHome } from '../types';
import { BottomNav, BusAvatar, ErrorBanner, HonestMapState, InitialAvatar, PageHeader, StateCard, createT } from './Shared';

type ParentTab = 'home' | 'map' | 'notifications' | 'profile';

export function ParentBusHome({ grantId, locale, onExit, onGrantLost }: { grantId: string; locale: Locale; onExit: () => void; onGrantLost: () => void }) {
  const t = createT(locale);
  const [data, setData] = useState<ParentHome | null>(null);
  const [tab, setTab] = useState<ParentTab>('home');
  const [error, setError] = useState('');
  const [notifications, setNotifications] = useState<BusNotification[]>([]);
  const load = useCallback(async () => {
    try { setData(await api<ParentHome>(`/parent/home?grantId=${grantId}`)); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('error')); if ((reason as { code?: string })?.code === 'PARENT_ACCESS_REVOKED') onGrantLost(); }
  }, [grantId, onGrantLost, t]);
  const loadNotifications = useCallback(async () => {
    try { const result = await api<{ notifications: BusNotification[] }>('/notifications'); setNotifications(result.notifications); }
    catch { /* The bus status remains usable without notification history. */ }
  }, []);
  useEffect(() => {
    void load(); void loadNotifications();
    const timer = setInterval(load, 25_000);
    let channel: ReturnType<typeof supabase.channel> | null = null;
    void supabase.auth.getUser().then(({ data: userData }) => {
      if (!userData.user) return;
      channel = supabase.channel(`bus-app-parent-${userData.user.id}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bus_app_parent_trip_updates', filter: `user_id=eq.${userData.user.id}` }, () => { void load(); })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bus_app_notifications', filter: `user_id=eq.${userData.user.id}` }, () => { void loadNotifications(); })
        .subscribe();
    });
    return () => { clearInterval(timer); if (channel) void supabase.removeChannel(channel); };
  }, [load, loadNotifications]);

  if (!data && !error) return <main className="app-shell"><StateCard icon={BusFront} title={t('loading')} /></main>;
  if (!data) return <main className="app-shell"><ErrorBanner message={error} onRetry={load} label={t('retry')} /></main>;
  const passenger = data.passengers[0];
  const passengerStatus = (status: string) => status === 'BOARDED' ? t('onBus') : status === 'MISSED' ? t('missed') : status === 'DROPPED_OFF' ? t('dropped') : t('expected');
  const tripStatus = data.trip?.status === 'IN_TRANSIT' ? t('onWay') : data.trip?.status === 'ARRIVED' ? t('arrived') : data.trip?.status === 'BOARDING' ? t('boarding') : t('noActiveTrip');

  return <main className="app-shell parent-home">
    <PageHeader title={<span className="header-identity"><BusAvatar kind={data.bus?.avatar_key} />{data.bus?.name || data.space.name}</span>} action={<button className="icon-button" onClick={onExit} aria-label={t('switchMode')} title={t('switchMode')}><SwitchCamera aria-hidden="true" /></button>} />
    <div className="page-content">
      <ErrorBanner message={error} onRetry={load} label={t('retry')} />
      {tab === 'home' && <>
        <section className="parent-hello"><p>{t('hello')} {data.parent.displayName}</p>{data.passengers.map((item) => <div key={item.id}><InitialAvatar name={item.display_name} avatar={item.avatar_key} /><strong>{item.display_name}</strong></div>)}</section>
        <section className="parent-journey">
          <header><span className={`live-dot ${data.trip?.status === 'IN_TRANSIT' ? 'active' : ''}`}><Circle aria-hidden="true" />{tripStatus}</span><BusAvatar kind={data.bus?.avatar_key} size={52} /></header>
          {data.trip && passenger?.etaMinutes !== null ? <div className="parent-eta"><small>{t('approximately')}</small><strong>{passenger?.etaMinutes} {t('minutes')}</strong></div> : <p className="no-trip-copy">{t('noActiveTrip')}</p>}
          <div className="own-stop"><MapPin aria-hidden="true" /><div><small>{t('yourStop')}</small><strong>{passenger?.stop?.display_address || '—'}</strong></div></div>
        </section>
        {data.passengers.map((item) => <section className="parent-passenger-status" key={item.id}><InitialAvatar name={item.display_name} avatar={item.avatar_key} /><span><strong>{item.display_name}</strong><small>{passengerStatus(item.status)}</small></span><b className={`status-tag status-${item.status.toLowerCase()}`}>{item.status === 'BOARDED' || item.status === 'DROPPED_OFF' ? <CircleCheck aria-hidden="true" /> : <Circle aria-hidden="true" />}</b></section>)}
      </>}
      {tab === 'map' && <section className="parent-map">
        <h1>{t('map')}</h1>
        <HonestMapState title={t('mapUnavailable')} body={t('mapUnavailableBody')} />
        <div className="map-facts"><p><BusFront aria-hidden="true" /><span><small>{t('currentBusPosition')}</small><strong>{data.trip?.location ? new Date(data.trip.location.capturedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : t('noActiveTrip')}</strong></span></p><p><MapPin aria-hidden="true" /><span><small>{t('ownStopPosition')}</small><strong>{passenger?.stop?.display_address || '—'}</strong></span></p></div>
        <aside className="privacy-note"><ShieldCheck aria-hidden="true" /><span><strong>{t('privacyTitle')}</strong><small>{t('privacyBody')}</small></span></aside>
      </section>}
      {tab === 'notifications' && <section className="notifications-page"><h1>{t('notifications')}</h1>{notifications.length ? notifications.map((notification) => <article key={notification.id}><Bell aria-hidden="true" /><div><strong>{notification.title}</strong><p>{notification.message}</p><small className="inline-fact"><Clock3 aria-hidden="true" />{new Date(notification.created_at).toLocaleString(locale)}</small></div></article>) : <StateCard icon={Bell} title={t('noNotifications')} />}</section>}
      {tab === 'profile' && <section className="profile-page"><StateCard icon={UsersRound} title={data.parent.displayName} body={data.passengers.map((item) => item.display_name).join(' · ')} /><aside className="privacy-note"><ShieldCheck aria-hidden="true" /><span><strong>{t('privacyTitle')}</strong><small>{t('privacyBody')}</small></span></aside><button className="danger-link logout-button button-with-icon" onClick={async () => { await supabase.auth.signOut(); onGrantLost(); }}><LogOut aria-hidden="true" />{t('logout')}</button></section>}
    </div>
    <BottomNav items={[
      { key: 'home', icon: BusFront, label: locale === 'fr' ? 'Mon bus' : 'Mijn bus', active: tab === 'home', onClick: () => setTab('home') },
      { key: 'map', icon: MapPinned, label: t('map'), active: tab === 'map', onClick: () => setTab('map') },
      { key: 'notifications', icon: Bell, label: t('notifications'), active: tab === 'notifications', onClick: () => setTab('notifications') },
      { key: 'profile', icon: UserRound, label: t('profile'), active: tab === 'profile', onClick: () => setTab('profile') },
    ]} />
  </main>;
}
