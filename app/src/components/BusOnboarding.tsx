import { useState, type FormEvent } from 'react';
import { Bus, BusFront, CarFront, CircleUserRound } from 'lucide-react';
import { api } from '../api';
import type { LocationChoice, Locale } from '../types';
import { AddressPicker } from './AddressPicker';
import { Brand, BusyButton, ErrorBanner, LanguageSwitch, createT } from './Shared';

export function BusOnboarding({ locale, onLocale, onCreated, onLogout }: { locale: Locale; onLocale: (locale: Locale) => void; onCreated: () => Promise<void>; onLogout: () => void }) {
  const t = createT(locale);
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<'bus' | 'van' | 'coach'>('bus');
  const [capacity, setCapacity] = useState(16);
  const [start, setStart] = useState<LocationChoice | null>(null);
  const [end, setEnd] = useState<LocationChoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!start) return;
    setBusy(true);
    setError('');
    try {
      await api('/spaces', { method: 'POST', idempotent: true, body: { name, avatarKey: avatar, defaultLanguage: locale, capacity, start, end } });
      await onCreated();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('error'));
    } finally {
      setBusy(false);
    }
  }

  const choices = [{ key: 'bus', label: 'Bus', Icon: BusFront }, { key: 'van', label: 'Van', Icon: CarFront }, { key: 'coach', label: 'Coach', Icon: Bus }] as const;
  return <main className="onboarding-shell">
    <div className="entry-top"><button className="text-button" onClick={onLogout}>{t('logout')}</button><LanguageSwitch locale={locale} onChange={onLocale} /></div>
    <Brand />
    <section className="onboarding-card">
      <header><CircleUserRound aria-hidden="true" /><div><small>{t('welcome')}</small><h1>{t('firstBus')}</h1></div></header>
      <ErrorBanner message={error} />
      <form onSubmit={submit}>
        <label>{t('busName')}<input required minLength={2} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <fieldset><legend>{t('avatar')}</legend><div className="avatar-choices">{choices.map(({ key, label, Icon }) => <button type="button" key={key} aria-label={label} aria-pressed={avatar === key} onClick={() => setAvatar(key)}><Icon aria-hidden="true" /></button>)}</div></fieldset>
        <label>{t('capacity')}<input required type="number" min={1} max={120} value={capacity} onChange={(event) => setCapacity(Number(event.target.value))} /></label>
        <AddressPicker locale={locale} label={t('startAddress')} value={start} onChange={setStart} />
        <details><summary>{t('moreOptions')}</summary><AddressPicker optional locale={locale} label={t('endAddress')} value={end} onChange={setEnd} /></details>
        <BusyButton busy={busy} className="primary-button jumbo" disabled={!start || name.trim().length < 2}>{t('createBus')}</BusyButton>
      </form>
    </section>
  </main>;
}
