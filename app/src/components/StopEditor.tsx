import { useState, type FormEvent } from 'react';
import { ArrowLeft, MapPin, Minus, Plus } from 'lucide-react';
import { api } from '../api';
import type { LocationChoice, Locale } from '../types';
import { AddressPicker } from './AddressPicker';
import { BusyButton, ErrorBanner, createT } from './Shared';

export function StopEditor({ spaceId, locale, onDone, onCancel }: { spaceId: string; locale: Locale; onDone: () => Promise<void>; onCancel: () => void }) {
  const t = createT(locale);
  const [location, setLocation] = useState<LocationChoice | null>(null);
  const [count, setCount] = useState(1);
  const [names, setNames] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!location) return;
    setBusy(true);
    setError('');
    try {
      await api(`/spaces/${spaceId}/stops`, { method: 'POST', idempotent: true, body: { location, expectedPassengerCount: count, passengerNames: names.split('\n').map((name) => name.trim()).filter(Boolean).slice(0, count) } });
      await onDone();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('error'));
    } finally {
      setBusy(false);
    }
  }

  return <section className="editor-card">
    <button className="back-link button-with-icon" onClick={onCancel}><ArrowLeft aria-hidden="true" />{t('back')}</button>
    <h1 className="heading-with-icon"><MapPin aria-hidden="true" />{t('addAddress')}</h1>
    <ErrorBanner message={error} />
    <form onSubmit={submit}>
      <AddressPicker locale={locale} label={t('address')} value={location} onChange={setLocation} />
      <label>{t('passengerCount')}<div className="counter"><button type="button" onClick={() => setCount(Math.max(0, count - 1))} aria-label={t('decrease')}><Minus aria-hidden="true" /></button><strong>{count}</strong><button type="button" onClick={() => setCount(Math.min(120, count + 1))} aria-label={t('increase')}><Plus aria-hidden="true" /></button></div></label>
      <label>{t('addNames')}<textarea rows={Math.min(6, Math.max(2, count))} placeholder={t('namesHint')} value={names} onChange={(event) => setNames(event.target.value)} /></label>
      <BusyButton busy={busy} className="primary-button jumbo" disabled={!location}>{t('add')}</BusyButton>
    </form>
  </section>;
}
