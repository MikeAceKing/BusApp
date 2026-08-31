import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, KeyRound, ShieldCheck, UsersRound } from 'lucide-react';
import { api } from '../api';
import { supabase } from '../supabase';
import type { Locale } from '../types';
import { Brand, BusyButton, LanguageSwitch, createT } from './Shared';

export function ParentCode({ locale, onLocale, onBack, onActivated }: { locale: Locale; onLocale: (locale: Locale) => void; onBack: () => void; onActivated: () => Promise<void> }) {
  const t = createT(locale);
  const [code, setCode] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void (async () => {
      const current = await supabase.auth.getSession();
      if (!current.data.session) {
        const signed = await supabase.auth.signInAnonymously({ options: { data: { source: 'busapp-parent-device' } } });
        if (signed.error && active) setError(signed.error.message);
      }
      if (active) setReady(true);
    })();
    return () => { active = false; };
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await api('/parent/activate', { method: 'POST', body: { code }, idempotent: true }); await onActivated(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('invalidCode')); }
    finally { setBusy(false); }
  }
  return <main className="parent-code-shell">
    <div className="entry-top"><button className="icon-button" onClick={onBack} aria-label={t('back')} title={t('back')}><ArrowLeft aria-hidden="true" /></button><LanguageSwitch locale={locale} onChange={onLocale} /></div>
    <Brand />
    <section className="code-card">
      <span><UsersRound aria-hidden="true" /></span>
      <h1>{t('parentCode')}</h1><p>{t('parentRoleHelp')}</p>
      <form onSubmit={submit}><input aria-label={t('parentCode')} inputMode="text" autoCapitalize="characters" autoComplete="one-time-code" placeholder={t('codePlaceholder')} value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} maxLength={20} /><BusyButton busy={busy || !ready} className="primary-button button-with-icon" disabled={code.replace(/[^A-Z0-9]/g, '').length < 8}><KeyRound aria-hidden="true" />{t('openBus')}</BusyButton></form>
      {error && <p className="form-message error" role="alert">{error}</p>}
      <aside className="privacy-note"><ShieldCheck aria-hidden="true" /><span><strong>{t('privacyTitle')}</strong><small>{t('privacyBody')}</small></span></aside>
    </section>
  </main>;
}
