import { useMemo, useState, type FormEvent } from 'react';
import { Copy, KeyRound, MapPin, Plus, RotateCcw, UserRoundPlus, UserX } from 'lucide-react';
import { api } from '../api';
import type { AvatarStyle, Locale, SpaceHome } from '../types';
import { BusyButton, ErrorBanner, InitialAvatar, createT } from './Shared';

const avatarStyles: AvatarStyle[] = ['initials-blue', 'initials-green', 'initials-purple', 'initials-orange', 'initials-rose'];

export function PassengerManager({ home, locale, onChanged }: { home: SpaceHome; locale: Locale; onChanged: () => Promise<void> }) {
  const t = createT(locale);
  const [mode, setMode] = useState<'passenger' | 'code'>('passenger');
  const [stopId, setStopId] = useState(home.stops[0]?.id || '');
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<AvatarStyle>('initials-blue');
  const [parentName, setParentName] = useState('');
  const [passengerId, setPassengerId] = useState(home.passengers[0]?.id || '');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);
  const stops = useMemo(() => new Map(home.stops.map((stop) => [stop.id, stop])), [home.stops]);

  async function createPassenger(event: FormEvent) {
    event.preventDefault(); setBusy('passenger'); setError('');
    try { await api(`/spaces/${home.space.id}/passengers`, { method: 'POST', idempotent: true, body: { stopId, displayName: name, avatarKey: avatar } }); setName(''); await onChanged(); }
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

  const avatarLabels: Record<AvatarStyle, string> = { 'initials-blue': t('avatarBlue'), 'initials-green': t('avatarGreen'), 'initials-purple': t('avatarPurple'), 'initials-orange': t('avatarOrange'), 'initials-rose': t('avatarRose') };
  return <section className="passenger-page">
    <header className="section-heading"><div><small>{home.space.name}</small><h1>{t('passengers')}</h1></div><strong>{home.passengers.length}</strong></header>
    <ErrorBanner message={error} />
    <div className="passenger-cards">{home.passengers.map((passenger) => <article key={passenger.id}><InitialAvatar name={passenger.display_name} avatar={passenger.avatar_key} /><span><strong>{passenger.display_name}</strong><small className="inline-fact"><MapPin aria-hidden="true" />{stops.get(passenger.stop_id)?.display_address || '—'}</small></span></article>)}</div>
    <div className="segmented"><button className={mode === 'passenger' ? 'active' : ''} onClick={() => setMode('passenger')}><UserRoundPlus aria-hidden="true" />{t('newPassenger')}</button><button className={mode === 'code' ? 'active' : ''} onClick={() => setMode('code')}><KeyRound aria-hidden="true" />{t('parentCodes')}</button></div>
    {mode === 'passenger' ? <form className="manager-form" onSubmit={createPassenger}>
      <label>{t('yourStop')}<select required value={stopId} onChange={(event) => setStopId(event.target.value)}><option value="">—</option>{home.stops.map((stop) => <option key={stop.id} value={stop.id}>{stop.display_address}</option>)}</select></label>
      <label>{t('displayName')}<input required maxLength={50} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <fieldset className="avatar-style-picker"><legend>{t('avatar')}</legend><div>{avatarStyles.map((style) => <button type="button" key={style} aria-label={avatarLabels[style]} title={avatarLabels[style]} aria-pressed={avatar === style} onClick={() => setAvatar(style)}><InitialAvatar name={name || 'Bus App'} avatar={style} /></button>)}</div></fieldset>
      <BusyButton busy={busy === 'passenger'} className="primary-button button-with-icon" disabled={!stopId}><Plus aria-hidden="true" />{t('add')}</BusyButton>
    </form> : <>
      <form className="manager-form" onSubmit={createAccess}><label>{t('parentName')}<input required maxLength={50} value={parentName} onChange={(event) => setParentName(event.target.value)} /></label><label>{t('selectPassenger')}<select required value={passengerId} onChange={(event) => setPassengerId(event.target.value)}><option value="">—</option>{home.passengers.map((passenger) => <option key={passenger.id} value={passenger.id}>{passenger.display_name}</option>)}</select></label><BusyButton busy={busy === 'code'} className="primary-button button-with-icon" disabled={!passengerId}><KeyRound aria-hidden="true" />{t('createCode')}</BusyButton></form>
      {code && <div className="code-reveal"><small>{t('codeTitle')}</small><strong>{code}</strong><button className="button-with-icon" onClick={async () => { await navigator.clipboard.writeText(code); setCopied(true); }}><Copy aria-hidden="true" />{copied ? t('copied') : t('copyCode')}</button></div>}
      <div className="access-list">{home.parentAccess.map((access) => <article key={access.id}><KeyRound aria-hidden="true" /><div><strong>{access.parent_display_name}</strong><small>{access.passengerIds.map((id) => home.passengers.find((passenger) => passenger.id === id)?.display_name).filter(Boolean).join(' · ')}</small></div><button className="button-with-icon" disabled={Boolean(busy)} onClick={() => regenerate(access.id)}><RotateCcw aria-hidden="true" />{t('newCode')}</button><button className="danger-link button-with-icon" disabled={Boolean(busy)} onClick={() => revoke(access.id)}><UserX aria-hidden="true" />{t('revokeAll')}</button></article>)}</div>
    </>}
  </section>;
}
