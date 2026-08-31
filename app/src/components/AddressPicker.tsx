import { useState } from 'react';
import { CircleCheck, MapPin } from 'lucide-react';
import { api } from '../api';
import type { LocationChoice, Locale } from '../types';
import { AddressText, BusyButton, createT } from './Shared';

export function AddressPicker({ locale, label, value, onChange, optional = false }: { locale: Locale; label: string; value: LocationChoice | null; onChange: (value: LocationChoice | null) => void; optional?: boolean }) {
  const t = createT(locale);
  const [query, setQuery] = useState(value?.displayAddress || '');
  const [results, setResults] = useState<LocationChoice[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function search() {
    if (optional && !query.trim()) { onChange(null); setResults([]); return; }
    setBusy(true);
    setError('');
    try {
      const response = await api<{ results: LocationChoice[] }>(`/geocode?q=${encodeURIComponent(query)}&locale=${locale}`);
      setResults(response.results);
      if (!response.results.length) setError(t('error'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('error'));
    } finally {
      setBusy(false);
    }
  }

  return <div className="address-picker">
    <label>{label}<div className="address-search"><input value={query} onChange={(event) => { setQuery(event.target.value); onChange(null); }} placeholder={t('addressPlaceholder')} autoComplete="street-address" /><BusyButton busy={busy} type="button" onClick={search} disabled={query.trim().length < 5}>{t('searchAddress')}</BusyButton></div></label>
    {value && <div className="selected-address"><CircleCheck aria-hidden="true" /><AddressText address={value.displayAddress} /></div>}
    {results.length > 0 && <div className="address-results" role="listbox" aria-label={t('chooseAddress')}>{results.map((result) => <button type="button" key={`${result.provider}:${result.reference}:${result.displayAddress}`} onClick={() => { onChange(result); setQuery(result.displayAddress); setResults([]); }}><MapPin aria-hidden="true" /><span>{result.displayAddress}</span></button>)}</div>}
    {error && <small className="field-error">{error}</small>}
  </div>;
}
