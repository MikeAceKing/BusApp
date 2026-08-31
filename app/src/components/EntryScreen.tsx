import { BusFront, ChevronRight, UsersRound } from 'lucide-react';
import type { EntryMode, Locale } from '../types';
import { Brand, LanguageSwitch, createT } from './Shared';

export function EntryScreen({ locale, onLocale, onSelect }: { locale: Locale; onLocale: (locale: Locale) => void; onSelect: (mode: EntryMode) => void }) {
  const t = createT(locale);
  return <main className="entry-shell">
    <div className="entry-top"><span /><LanguageSwitch locale={locale} onChange={onLocale} /></div>
    <section className="entry-intro"><Brand /><h1>{t('welcome')}</h1><p>{t('question')}</p></section>
    <div className="role-grid">
      <button className="role-card role-card--bus" onClick={() => onSelect('BUS')}>
        <span className="role-card__icon"><BusFront aria-hidden="true" /></span>
        <span><strong>{t('busRole')}</strong><small>{t('busRoleHelp')}</small></span>
        <ChevronRight aria-hidden="true" />
      </button>
      <button className="role-card role-card--parent" onClick={() => onSelect('PARENT')}>
        <span className="role-card__icon"><UsersRound aria-hidden="true" /></span>
        <span><strong>{t('parentRole')}</strong><small>{t('parentRoleHelp')}</small></span>
        <ChevronRight aria-hidden="true" />
      </button>
    </div>
  </main>;
}
