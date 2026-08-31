import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import { api } from './api';
import { supabase } from './supabase';
import type { ContextResponse, EntryMode, Locale } from './types';
import { BusHome } from './components/BusHome';
import { BusOnboarding } from './components/BusOnboarding';
import { DriverAuth } from './components/DriverAuth';
import { EntryScreen } from './components/EntryScreen';
import { ParentBusHome } from './components/ParentBusHome';
import { ParentCode } from './components/ParentCode';
import { StateCard, createT } from './components/Shared';

export default function App() {
  const [locale, setLocaleState] = useState<Locale>(() => localStorage.getItem('bus-app-locale') === 'fr' ? 'fr' : 'nl');
  const [mode, setModeState] = useState<EntryMode | null>(() => {
    const value = localStorage.getItem('bus-app-mode');
    return value === 'BUS' || value === 'PARENT' ? value : null;
  });
  const [session, setSession] = useState<Session | null>(null);
  const [context, setContext] = useState<ContextResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const t = createT(locale);

  const setLocale = (value: Locale) => {
    localStorage.setItem('bus-app-locale', value);
    setLocaleState(value);
  };
  const setMode = (value: EntryMode | null) => {
    if (value) localStorage.setItem('bus-app-mode', value);
    else localStorage.removeItem('bus-app-mode');
    setModeState(value);
    setError('');
  };
  const loadContext = useCallback(async () => {
    const current = await supabase.auth.getSession();
    if (!current.data.session) {
      setContext(null);
      return;
    }
    try {
      setContext(await api<ContextResponse>('/context'));
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('error'));
    }
  }, [t]);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setContext(null);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) void loadContext();
  }, [loadContext, session]);

  if (loading) return <main className="app-shell"><StateCard icon={LoaderCircle} title={t('loading')} /></main>;
  if (!mode) return <EntryScreen locale={locale} onLocale={setLocale} onSelect={setMode} />;

  const exit = () => setMode(null);
  if (mode === 'PARENT') {
    const grant = context?.parentGrants[0];
    if (grant) return <ParentBusHome grantId={grant.id} locale={locale} onExit={exit} onGrantLost={() => setContext((current) => current ? { ...current, parentGrants: [] } : current)} />;
    return <ParentCode locale={locale} onLocale={setLocale} onBack={exit} onActivated={loadContext} />;
  }

  if (!session || session.user.is_anonymous) return <DriverAuth locale={locale} onLocale={setLocale} onBack={exit} />;
  if (error && !context) return <main className="app-shell"><StateCard icon={CircleAlert} title={error} action={<button className="primary-button" onClick={loadContext}>{t('retry')}</button>} /></main>;
  const space = context?.spaces[0];
  if (!space) return <BusOnboarding locale={locale} onLocale={setLocale} onLogout={() => supabase.auth.signOut()} onCreated={loadContext} />;
  return <BusHome space={space} locale={locale} onExit={exit} />;
}
