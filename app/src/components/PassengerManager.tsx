import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Copy, KeyRound, MapPin, Pencil, Plus, RotateCcw, UserRoundPlus, UserX, X } from 'lucide-react';
import { api } from '../api';
import type { AvatarStyle, Locale, SpaceHome } from '../types';
import { AddressText, BusyButton, CountLabel, ErrorBanner, createT, formatBelgianAddress } from './Shared';
import { AvatarDisplay, AvatarEditor } from './AvatarProfiles';

const avatarStyles: AvatarStyle[] = ['initials-blue', 'initials-green', 'initials-purple', 'initials-orange', 'initials-rose'];

export function PassengerManager({ home, locale, onChanged }: { home: SpaceHome; locale: Locale; onChanged: () => Promise<void> }) {
  const t = createT(locale);
  const [mode, setMode] = useState<'passenger' | 'code' | null>(null);
  const [stopId, setStopId] = useState(home.stops[0]?.id || '');
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<AvatarStyle>('initials-blue');
  const [builtInAvatar,setBuiltInAvatar]=useState('child-01');
  const [editingAvatar,setEditingAvatar]=useState('');
  const [parentName, setParentName] = useState('');
  const [passengerId, setPassengerId] = useState(home.passengers[0]?.id || '');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const stops = useMemo(() => new Map(home.stops.map((stop) => [stop.id, stop])), [home.stops]);
  useEffect(() => {
    if (mode) panelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [mode]);

  async function createPassenger(event: FormEvent) {
    event.preventDefault(); setBusy('passenger'); setError('');
    try { await api(`/spaces/${home.space.id}/passengers`, { method: 'POST', idempotent: true, body: { stopId, displayName: name, avatarKey: avatar, builtInAvatarId: builtInAvatar } }); setName(''); setMode(null); await onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('error')); }
    finally { setBusy(''); }
  }
  async function createAccess(event: FormEvent) {
    event.preventDefault(); setBusy('code'); setError('');
    try { const result = await api<{ code: string }>(`/spaces/${home.space.id}/parent-access`, { method: 'POST', idempotent: true, body: { parentDisplayName: parentName, passengerIds: [passengerId] } }); setCode(result.code); setParentName(''); await onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('error')); }
    finally { setBusy(''); }
  }
  async function regenerate(id: string) {
    if (!confirm(t('confirmNewCode'))) return; setBusy(id); setError('');
    try { const result = await api<{ code: string }>(`/spaces/${home.space.id}/parent-access/${id}/regenerate`, { method: 'POST', idempotent: true, body: { confirm: true } }); setCode(result.code); await onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('error')); }
    finally { setBusy(''); }
  }
  async function revoke(id: string) {
    if (!confirm(t('revokeAll'))) return; setBusy(id); setError('');
    try { await api(`/spaces/${home.space.id}/parent-access/${id}/revoke`, { method: 'POST', idempotent: true, body: { confirm: true } }); await onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('error')); }
    finally { setBusy(''); }
  }

  return <section className="passenger-page">
    <header className="section-heading"><div><small>{home.bus?.name || home.space.name}</small><h1>{t('passengers')}</h1></div><strong>{home.passengers.length}</strong></header>
    <ErrorBanner message={error} />
    {home.passengers.length ? <div className="passenger-cards">{home.passengers.map((passenger) => <article key={passenger.id} className="passenger-profile-card"><AvatarDisplay kind="child" avatar={passenger.avatar} name={passenger.display_name}/><span><strong>{passenger.display_name}</strong>{stops.get(passenger.stop_id) ? <span className="inline-fact"><MapPin aria-hidden="true" /><AddressText address={stops.get(passenger.stop_id)!.display_address} compact /></span> : <small>—</small>}</span>{passenger.avatar&&<button className="secondary-button button-with-icon edit-affordance" aria-expanded={editingAvatar===passenger.id} onClick={()=>setEditingAvatar((current)=>current===passenger.id?'':passenger.id)}><Pencil aria-hidden="true"/>{t('editAvatar')}</button>}{editingAvatar===passenger.id&&passenger.avatar&&<div className="passenger-avatar-editor"><AvatarEditor kind="child" avatar={passenger.avatar} name={passenger.display_name} locale={locale} patchPath={`/spaces/${home.space.id}/passengers/${passenger.id}/avatar`} uploadPath={`/spaces/${home.space.id}/passengers/${passenger.id}`} onChanged={async()=>{await onChanged();}}/><div className="edit-actions"><button type="button" className="secondary-button" onClick={()=>setEditingAvatar('')}>{t('cancelEdit')}</button></div></div>}</article>)}</div> : <section className="passenger-empty"><UserRoundPlus aria-hidden="true" /><div><h2>{t('noPassengers')}</h2><p>{t('noPassengersHelp')}</p></div></section>}
    <div className="passenger-actions"><button className="secondary-button button-with-icon" aria-expanded={mode === 'passenger'} onClick={() => setMode(mode === 'passenger' ? null : 'passenger')}><UserRoundPlus aria-hidden="true" />{t('newPassenger')}</button><button className="secondary-button parent-code-button" aria-expanded={mode === 'code'} onClick={() => setMode(mode === 'code' ? null : 'code')}><KeyRound aria-hidden="true" /><span>{t('parentCodes')}</span><b><CountLabel count={home.parentAccess.length} one={t('codeOne')} many={t('codeMany')} /></b></button></div>
    {mode === 'passenger' && <section className="manager-panel" ref={panelRef}><header><div><h2>{t('newPassenger')}</h2><p>{t('chooseAvatar')}</p></div><button className="icon-button" onClick={() => setMode(null)} aria-label={t('closeForm')}><X aria-hidden="true" /></button></header><form className="manager-form" onSubmit={createPassenger}>
      <label>{t('yourStop')}<select required value={stopId} onChange={(event) => setStopId(event.target.value)}><option value="">—</option>{home.stops.map((stop) => { const address = formatBelgianAddress(stop.display_address, stop.label); return <option key={stop.id} value={stop.id}>{[address.primary, address.secondary].filter(Boolean).join(' — ')}</option>; })}</select></label>
      <label>{t('passengerDisplayName')}<input required maxLength={50} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <div className="avatar-preview"><img className="canonical-avatar" src={`/avatars/${builtInAvatar}.svg`} alt=""/><strong>{name || t('passengerDisplayName')}</strong></div>
      <fieldset className="avatar-style-picker"><legend>{t('choosePassengerAvatar')}</legend><div className="avatar-catalog avatar-catalog--child">{Array.from({length:24},(_,index)=>`child-${String(index+1).padStart(2,'0')}`).map((id) => <button type="button" key={id} aria-label={id} aria-pressed={builtInAvatar === id} onClick={() => {setBuiltInAvatar(id);setAvatar(avatarStyles[Number(id.slice(-2))%avatarStyles.length]);}}><img src={`/avatars/${id}.svg`} alt=""/></button>)}</div></fieldset>
      <BusyButton busy={busy === 'passenger'} className="primary-button button-with-icon" disabled={!stopId}><Plus aria-hidden="true" />{t('add')}</BusyButton>
    </form></section>}
    {mode === 'code' && <section className="manager-panel" ref={panelRef}><header><div><h2>{t('parentCodes')}</h2><p><CountLabel count={home.parentAccess.length} one={t('codeOne')} many={t('codeMany')} /></p></div><button className="icon-button" onClick={() => setMode(null)} aria-label={t('closeForm')}><X aria-hidden="true" /></button></header>
      <form className="manager-form" onSubmit={createAccess}><label>{t('parentName')}<input required maxLength={50} value={parentName} onChange={(event) => setParentName(event.target.value)} /></label><label>{t('selectPassenger')}<select required value={passengerId} onChange={(event) => setPassengerId(event.target.value)}><option value="">—</option>{home.passengers.map((passenger) => <option key={passenger.id} value={passenger.id}>{passenger.display_name}</option>)}</select></label><BusyButton busy={busy === 'code'} className="primary-button button-with-icon" disabled={!passengerId}><KeyRound aria-hidden="true" />{t('createCode')}</BusyButton></form>
      {code && <div className="code-reveal"><small>{t('codeTitle')}</small><strong>{code}</strong><button className="button-with-icon" onClick={async () => { await navigator.clipboard.writeText(code); setCopied(true); }}><Copy aria-hidden="true" />{copied ? t('copied') : t('copyCode')}</button></div>}
      <div className="access-list">{home.parentAccess.map((access) => <article key={access.id}><KeyRound aria-hidden="true" /><div><strong>{access.parent_display_name}</strong><small>{access.passengerIds.map((id) => home.passengers.find((passenger) => passenger.id === id)?.display_name).filter(Boolean).join(' · ')}</small></div><button className="button-with-icon" disabled={Boolean(busy)} onClick={() => regenerate(access.id)}><RotateCcw aria-hidden="true" />{t('newCode')}</button><button className="danger-link button-with-icon" disabled={Boolean(busy)} onClick={() => revoke(access.id)}><UserX aria-hidden="true" />{t('revokeAll')}</button></article>)}</div>
    </section>}
  </section>;
}
