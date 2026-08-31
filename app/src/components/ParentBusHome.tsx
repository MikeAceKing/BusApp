import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Bell, BusFront, ChevronRight, Circle, CircleCheck, Clock3, LogOut, MapPin, MapPinned, Pencil, ShieldCheck, SwitchCamera, UserRound } from 'lucide-react';
import { api } from '../api';
import { supabase } from '../supabase';
import type { BusNotification, Locale, ParentHome, ParentVisibleBusProfile, ParentVisibleStaffProfile } from '../types';
import { AddressText, BottomNav, ErrorBanner, FriendlyBus, HonestMapState, StateCard, createT, type T } from './Shared';
import { AvatarDisplay, AvatarEditor, UserProfileEditor, roleLabel } from './AvatarProfiles';

type ParentTab = 'home' | 'map' | 'notifications' | 'profile';

export function ParentBusHome({ grantId, locale, onLocale, onExit, onGrantLost }: { grantId: string; locale: Locale; onLocale:(locale:Locale)=>void; onExit: () => void; onGrantLost: () => void }) {
  const t = createT(locale);
  const [data, setData] = useState<ParentHome | null>(null);
  const [tab, setTab] = useState<ParentTab>('home');
  const [error, setError] = useState('');
  const [notifications, setNotifications] = useState<BusNotification[]>([]);
  const [busProfile, setBusProfile] = useState<ParentVisibleBusProfile | null>(null);
  const [busProfileOpen, setBusProfileOpen] = useState(false);
  const [editingPassenger, setEditingPassenger] = useState('');
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [tab]);
  const load = useCallback(async () => {
    try { setData(await api<ParentHome>(`/parent/home?grantId=${grantId}`)); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('error')); if ((reason as { code?: string })?.code === 'PARENT_ACCESS_REVOKED') onGrantLost(); }
  }, [grantId, onGrantLost, t]);
  const loadNotifications = useCallback(async () => {
    try { const result = await api<{ notifications: BusNotification[] }>('/notifications'); setNotifications(result.notifications); }
    catch { /* The bus status remains usable without notification history. */ }
  }, []);
  const loadBusProfile = useCallback(async () => {
    try { setBusProfile(await api<ParentVisibleBusProfile>(`/parent/bus-profile?grantId=${grantId}`)); }
    catch { /* The bus profile is optional context; the journey view stays usable without it. */ }
  }, [grantId]);
  useEffect(() => { if (busProfileOpen) void loadBusProfile(); }, [busProfileOpen, loadBusProfile, data?.bus?.avatar?.version]);
  useEffect(() => {
    void load(); void loadNotifications();
    const timer = setInterval(load, 25_000);
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let disposed = false;
    void supabase.auth.getUser().then(({ data: userData }) => {
      if (disposed || !userData.user) return;
      channel = supabase.channel(`bus-app-parent-${userData.user.id}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bus_app_parent_trip_updates', filter: `user_id=eq.${userData.user.id}` }, () => { void load(); })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bus_app_notifications', filter: `user_id=eq.${userData.user.id}` }, () => { void loadNotifications(); })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bus_app_avatar_updates', filter: `user_id=eq.${userData.user.id}` }, () => { void load(); })
        .subscribe();
    });
    return () => { disposed = true; clearInterval(timer); if (channel) void supabase.removeChannel(channel); };
  }, [load, loadNotifications]);

  if (!data && !error) return <main className="app-shell"><StateCard icon={BusFront} title={t('loading')} /></main>;
  if (!data) return <main className="app-shell"><ErrorBanner message={error} onRetry={load} label={t('retry')} /></main>;
  const passenger = data.passengers[0];
  const passengerStatus = (status: string) => status === 'BOARDED' ? t('onBus') : status === 'MISSED' ? t('missed') : status === 'DROPPED_OFF' ? t('dropped') : t('expected');
  const tripStatus = data.trip?.status === 'IN_TRANSIT' ? (passenger?.etaMinutes !== null && Number(passenger?.etaMinutes) <= 5 ? t('almostThere') : t('onWay')) : data.trip?.status === 'ARRIVED' ? t('arrived') : data.trip?.status === 'BOARDING' ? t('boarding') : t('noActiveTrip');

  return <main className="app-shell parent-home">
    <div className="page-content">
      <ErrorBanner message={error} onRetry={load} label={t('retry')} />
      {tab === 'home' && (busProfileOpen ? <ParentBusProfile profile={busProfile} locale={locale} onBack={() => setBusProfileOpen(false)} /> : <>
        <header className="section-heading"><div><small>{t('yourBus')}</small><h1>{data.bus?.name || data.space.name}</h1></div></header>
        <button className="parent-bus-cta" onClick={() => setBusProfileOpen(true)}><AvatarDisplay kind="bus" avatar={data.bus?.avatar} name={data.bus?.name || data.space.name}/><span><strong>{data.bus?.name || data.space.name}</strong><small>{t('viewBus')}</small></span><ChevronRight aria-hidden="true" /></button>
        <section className="parent-hello"><p>{t('hello')} {data.parent.displayName}</p>{data.passengers.map((item) => <div key={item.id}><AvatarDisplay kind="child" avatar={item.avatar} name={item.display_name}/><strong>{item.display_name}</strong></div>)}</section>
        <section className="parent-journey">
          <header><span className={`live-dot ${data.trip?.status === 'IN_TRANSIT' ? 'active' : ''}`}><Circle aria-hidden="true" />{tripStatus}</span><FriendlyBus size={82} /></header>
          {data.trip && passenger?.etaMinutes !== null ? <div className="parent-eta"><small>{t('approximately')}</small><strong>{passenger?.etaMinutes} {t('minutes')}</strong></div> : <p className="no-trip-copy">{t('noActiveTrip')}</p>}
          <div className="own-stop"><MapPin aria-hidden="true" /><div><small>{t('yourStop')}</small>{passenger?.stop ? <AddressText address={passenger.stop.display_address} /> : <strong>—</strong>}</div></div>
        </section>
        {data.passengers.map((item) => <section className="parent-passenger-status" key={item.id}><AvatarDisplay kind="child" avatar={item.avatar} name={item.display_name}/><span><strong>{item.display_name}</strong><small>{passengerStatus(item.status)}</small></span><b className={`status-tag status-${item.status.toLowerCase()}`}>{item.status === 'BOARDED' || item.status === 'DROPPED_OFF' ? <CircleCheck aria-hidden="true" /> : <Circle aria-hidden="true" />}</b></section>)}
      </>)}
      {tab === 'map' && <section className="parent-map">
        <h1>{t('map')}</h1>
        <HonestMapState title={t('mapUnavailable')} body={t('mapUnavailableBody')} />
        <div className="map-facts"><p><BusFront aria-hidden="true" /><span><small>{t('currentBusPosition')}</small><strong>{data.trip?.location ? new Date(data.trip.location.capturedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : t('noActiveTrip')}</strong></span></p><p><MapPin aria-hidden="true" /><span><small>{t('ownStopPosition')}</small>{passenger?.stop ? <AddressText address={passenger.stop.display_address} compact /> : <strong>—</strong>}</span></p></div>
        <aside className="privacy-note"><ShieldCheck aria-hidden="true" /><span><strong>{t('privacyTitle')}</strong><small>{t('privacyBody')}</small></span></aside>
      </section>}
      {tab === 'notifications' && <section className="notifications-page"><h1>{t('notifications')}</h1>{notifications.length ? notifications.map((notification) => <article key={notification.id}><Bell aria-hidden="true" /><div><strong>{notification.title}</strong><p>{notification.message}</p><small className="inline-fact"><Clock3 aria-hidden="true" />{new Date(notification.created_at).toLocaleString(locale)}</small></div></article>) : <StateCard icon={Bell} title={t('noNotifications')} />}</section>}
      {tab === 'profile' && <section className="profile-page">
        <header className="section-heading"><div><small>BusApp</small><h1>{t('profile')}</h1></div></header>
        <UserProfileEditor profile={data.parent.profile} fallbackName={data.parent.displayName} locale={locale} onLocale={onLocale} onChanged={load} role="PARENT"/>
        <h2 className="subsection-title">{t('passengers')}</h2>
        {data.passengers.map((item)=><section className="profile-editor-card" key={item.id}>
          <div className="profile-editor-card__head"><AvatarDisplay kind="child" avatar={item.avatar} name={item.display_name} size="large"/><div><h2>{item.display_name}</h2>{item.stop && <small>{item.stop.display_address}</small>}</div></div>
          {item.avatar && editingPassenger !== item.id && <button className="secondary-button button-with-icon edit-affordance" onClick={()=>setEditingPassenger(item.id)}><Pencil aria-hidden="true"/>{t('editAvatar')}</button>}
          {item.avatar && editingPassenger === item.id && <div className="profile-edit-panel">
            <AvatarEditor kind="child" avatar={item.avatar} name={item.display_name} locale={locale} patchPath={`/parent/passengers/${item.id}/avatar`} uploadPath={`/parent/passengers/${item.id}`} onChanged={load}/>
            <div className="edit-actions"><button type="button" className="secondary-button" onClick={()=>setEditingPassenger('')}>{t('cancelEdit')}</button></div>
          </div>}
        </section>)}
        <h2 className="subsection-title">{t('privacy')}</h2><aside className="privacy-note"><ShieldCheck aria-hidden="true" /><span><strong>{t('privacyTitle')}</strong><small>{t('privacyBody')}</small></span></aside>
        <button className="secondary-button button-with-icon" onClick={onExit}><SwitchCamera aria-hidden="true" />{t('switchMode')}</button>
        <button className="danger-link logout-button button-with-icon" onClick={async () => { await supabase.auth.signOut(); onGrantLost(); }}><LogOut aria-hidden="true" />{t('logout')}</button>
      </section>}
    </div>
    <BottomNav items={[
      { key: 'home', icon: BusFront, label: t('myBus'), active: tab === 'home', onClick: () => setTab('home') },
      { key: 'map', icon: MapPinned, label: t('map'), active: tab === 'map', onClick: () => setTab('map') },
      { key: 'notifications', icon: Bell, label: t('notifications'), active: tab === 'notifications', onClick: () => setTab('notifications') },
      { key: 'profile', icon: UserRound, label: t('profile'), active: tab === 'profile', onClick: () => setTab('profile') },
    ]} />
  </main>;
}

function StaffCard({ staff, locale }: { staff: ParentVisibleStaffProfile; locale: Locale }) {
  const t = createT(locale);
  return <article className="parent-staff-card"><AvatarDisplay kind="adult" avatar={staff.avatar} name={staff.displayName}/><span><strong>{staff.displayName}</strong><small>{roleLabel(t, staff.role)}</small></span></article>;
}

function ParentBusProfile({ profile, locale, onBack }: { profile: ParentVisibleBusProfile | null; locale: Locale; onBack: () => void }) {
  const t: T = createT(locale);
  if (!profile) return <section className="parent-bus-profile"><button className="secondary-button button-with-icon" onClick={onBack}><ArrowLeft aria-hidden="true" />{t('backToBus')}</button><StateCard icon={BusFront} title={t('loading')} /></section>;
  const status = profile.bus.currentTripStatus === 'IN_TRANSIT' ? t('onWay') : profile.bus.currentTripStatus === 'ARRIVED' ? t('arrived') : profile.bus.currentTripStatus === 'BOARDING' ? t('boarding') : t('noActiveTrip');
  return <section className="parent-bus-profile">
    <button className="secondary-button button-with-icon" onClick={onBack}><ArrowLeft aria-hidden="true" />{t('backToBus')}</button>
    <header className="section-heading"><div><small>{t('yourBus')}</small><h1>{profile.bus.displayName}</h1></div></header>
    <div className="parent-bus-photo"><AvatarDisplay kind="bus" avatar={profile.bus.avatar} name={profile.bus.displayName} size="large"/></div>
    <p className="parent-bus-status"><Circle aria-hidden="true" />{t('busToday')}: {status}</p>
    {profile.driver || profile.attendant ? <div className="parent-staff-list">
      {profile.driver && <StaffCard staff={profile.driver} locale={locale} />}
      {profile.attendant && <StaffCard staff={profile.attendant} locale={locale} />}
    </div> : <p className="profile-help">{t('noStaffAssigned')}</p>}
    {profile.ownStop && <div className="own-stop"><MapPin aria-hidden="true" /><div><small>{t('yourStop')}</small><AddressText address={profile.ownStop.displayAddress} /></div></div>}
    <aside className="privacy-note"><ShieldCheck aria-hidden="true" /><span><strong>{t('privacyTitle')}</strong><small>{t('privacyBody')}</small></span></aside>
  </section>;
}
