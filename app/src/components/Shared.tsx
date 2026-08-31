import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Bus, BusFront, CircleAlert, MapPinned } from 'lucide-react';
import { translate, type TranslationKey } from '../i18n';
import type { AvatarStyle, Locale } from '../types';

export type T = (key: TranslationKey, values?: Record<string, string | number>) => string;
const translators: Record<Locale, T> = {
  nl: (key, values) => translate('nl', key, values),
  fr: (key, values) => translate('fr', key, values),
};
export const createT = (locale: Locale): T => translators[locale];

export function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={`brand ${compact ? 'brand--compact' : ''}`}>
    <img className="brand__mark" src="/brand/busapp-mark.svg" alt="" aria-hidden="true" />
    <span><strong>BusApp</strong></span>
  </div>;
}

export function BusAvatar({ kind = 'bus', size = 24 }: { kind?: string | null; size?: number }) {
  const Icon = kind === 'coach' ? Bus : BusFront;
  return <Icon size={size} strokeWidth={2.2} aria-hidden="true" />;
}

export function LanguageSwitch({ locale, onChange }: { locale: Locale; onChange: (locale: Locale) => void }) {
  return <div className="language-switch" aria-label="NL / FR">
    <button className={locale === 'nl' ? 'active' : ''} onClick={() => onChange('nl')} aria-pressed={locale === 'nl'}>NL</button>
    <button className={locale === 'fr' ? 'active' : ''} onClick={() => onChange('fr')} aria-pressed={locale === 'fr'}>FR</button>
  </div>;
}

export function PageHeader({ title, action }: { title?: ReactNode; action?: ReactNode }) {
  return <header className="page-header"><Brand compact /><div className="page-header__title">{title}</div>{action}</header>;
}

export function StateCard({ icon: Icon, title, body, action }: { icon: LucideIcon; title: string; body?: string; action?: ReactNode }) {
  return <section className="state-card"><Icon className="state-card__icon" aria-hidden="true" /><h2>{title}</h2>{body && <p>{body}</p>}{action}</section>;
}

export function BusyButton({ busy, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return <button {...props} aria-busy={busy || undefined} disabled={busy || props.disabled}>{busy ? <span className="spinner" aria-hidden="true" /> : children}</button>;
}

export function ErrorBanner({ message, onRetry, label }: { message: string; onRetry?: () => void; label?: string }) {
  if (!message) return null;
  return <div className="error-banner" role="alert"><CircleAlert aria-hidden="true" /><span>{message}</span>{onRetry && <button onClick={onRetry}>{label || 'Retry'}</button>}</div>;
}

export function BottomNav({ items }: { items: Array<{ key: string; icon: LucideIcon; label: string; active: boolean; onClick: () => void }> }) {
  return <nav className="bottom-nav" aria-label="BusApp">{items.map((item) => {
    const Icon = item.icon;
    return <button key={item.key} className={item.active ? 'active' : ''} onClick={item.onClick} aria-current={item.active ? 'page' : undefined}>
      <Icon aria-hidden="true" />
      <span>{item.label}</span>
    </button>;
  })}</nav>;
}

const legacyAvatarStyles: Record<string, AvatarStyle> = {
  smile: 'initials-blue', child: 'initials-green', girl: 'initials-rose', star: 'initials-orange',
  rocket: 'initials-purple', rainbow: 'initials-rose', ball: 'initials-green', bag: 'initials-blue',
};
export function normalizeAvatarStyle(value?: string | null): AvatarStyle {
  if (value?.startsWith('initials-')) return value as AvatarStyle;
  return legacyAvatarStyles[value || ''] || 'initials-blue';
}
export function InitialAvatar({ name, avatar = 'initials-blue' }: { name: string; avatar?: string }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toLocaleUpperCase() || 'BA';
  return <span className={`avatar avatar--${normalizeAvatarStyle(avatar)}`} aria-label={name}>{initials}</span>;
}

export function HonestMapState({ title, body }: { title: string; body: string }) {
  return <section className="honest-map-state"><MapPinned aria-hidden="true" /><h2>{title}</h2><p>{body}</p></section>;
}
