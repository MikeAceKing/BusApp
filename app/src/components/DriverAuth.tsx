import { authCaptchaOptions } from '../lib/auth/captcha';
import { validatePasswordPolicy, PASSWORD_POLICY_COPY, PASSWORD_POLICY_MIN_LENGTH } from '../lib/auth/password-policy';
import { useState, type FormEvent } from 'react';
import { ArrowLeft } from 'lucide-react';
import { supabase } from '../supabase';
import type { Locale } from '../types';
import { Brand, BusyButton, FriendlyBus, LanguageSwitch, createT } from './Shared';

export function DriverAuth({ locale, onLocale, onBack }: { locale: Locale; onLocale: (locale: Locale) => void; onBack: () => void }) {
  const t = createT(locale);
  const [register, setRegister] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (register && !validatePasswordPolicy(password).valid) { setMessage(PASSWORD_POLICY_COPY[locale]); return; }
    setBusy(true);
    setMessage('');
    try {
    const current = await supabase.auth.getSession();
    if (current.data.session?.user.is_anonymous) await supabase.auth.signOut();
    if (register) {
      const result = await supabase.auth.signUp({ email, password, options: { ...await authCaptchaOptions(), data: { display_name: name, source: 'busapp' } } });
      if (result.error) setMessage(result.error.message);
      else if (!result.data.session) setMessage(t('confirmEmail'));
    } else {
      const result = await supabase.auth.signInWithPassword({ email, password, options: await authCaptchaOptions() });
      if (result.error) setMessage(result.error.message);
    }
    } catch { setMessage(locale === 'fr' ? 'Vérification indisponible. Réessayez.' : locale === 'nl' ? 'Verificatie niet beschikbaar. Probeer opnieuw.' : 'Verification unavailable. Please retry.'); }
    finally { setBusy(false); }
  }

  return <main className="auth-shell">
    <div className="entry-top"><button className="icon-button" onClick={onBack} aria-label={t('back')} title={t('back')}><ArrowLeft aria-hidden="true" /></button><LanguageSwitch locale={locale} onChange={onLocale} /></div>
    <Brand />
    <section className="auth-card">
      <span className="auth-role"><FriendlyBus size={58} /></span>
      <h1>{register ? t('register') : t('login')}</h1>
      <p className="muted">{t('busRoleHelp')} · {t('freePromise')}</p>
      <form onSubmit={submit}>
        {register && <label>{t('displayName')}<input required minLength={1} maxLength={50} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} /></label>}
        <label>{t('email')}<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>{t('password')}<input required minLength={register ? PASSWORD_POLICY_MIN_LENGTH : undefined} type="password" autoComplete={register ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <BusyButton busy={busy} className="primary-button" type="submit">{register ? t('register') : t('login')}</BusyButton>
      </form>
      {message && <p className="form-message" role="status">{message}</p>}
      <button className="text-button auth-switch" onClick={() => { setRegister(!register); setMessage(''); }}>{register ? t('existingAuth') : t('switchAuth')}</button>
    </section>
  </main>;
}
