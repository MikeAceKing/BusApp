import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { CircleAlert, MapPin, MapPinned } from 'lucide-react';
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
  return <FriendlyBus className={`friendly-bus friendly-bus--${kind || 'bus'}`} size={size} />;
}

export function FriendlyBus({ size = 120, className = 'friendly-bus' }: { size?: number; className?: string }) {
  return <svg className={className} width={size} height={Math.round(size * .68)} viewBox="0 0 180 122" aria-hidden="true">
    <path d="M28 26c1-10 9-17 19-18h75c18 0 31 10 35 27l8 39v17c0 7-5 12-12 12h-4a20 20 0 0 1-39 0H69a20 20 0 0 1-39 0h-5c-7 0-12-5-12-12V47c0-12 5-19 15-21Z" fill="currentColor" />
    <path d="M39 20h79c12 0 20 6 24 18l4 20H31V33c0-7 3-11 8-13Z" fill="#fff8dd" />
    <path d="M40 28h27v22H36V35c0-4 1-6 4-7Zm36 0h29v22H76V28Zm38 0h5c8 0 13 4 16 12l3 10h-24V28Z" fill="#9fe3f5" />
    <path d="M14 66h151v25c0 7-5 12-12 12H25c-7 0-11-5-11-12V66Z" fill="#ffc83d" />
    <path d="M25 73h128" stroke="#173f53" strokeWidth="5" strokeLinecap="round" opacity=".18" />
    <rect x="20" y="76" width="11" height="8" rx="4" fill="#fff" />
    <rect x="148" y="76" width="11" height="8" rx="4" fill="#f46d70" />
    <circle cx="50" cy="101" r="15" fill="#173f53" /><circle cx="50" cy="101" r="6" fill="#dcecf1" />
    <circle cx="129" cy="101" r="15" fill="#173f53" /><circle cx="129" cy="101" r="6" fill="#dcecf1" />
  </svg>;
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

export type PresentedAddress = { primary: string; secondary: string; full: string };
export function formatBelgianAddress(fullAddress: string, preferredLabel?: string | null): PresentedAddress {
  const full = fullAddress.trim();
  const parts = full.split(',').map((part) => part.trim()).filter(Boolean);
  const postcodeMatch = full.match(/\b([1-9]\d{3})\b/);
  const postcode = postcodeMatch?.[1] || '';
  let primary = preferredLabel?.trim() || parts[0] || full;
  if (!preferredLabel && /^\d+[a-zA-Z]?$/.test(parts[0] || '') && parts[1]) primary = `${parts[1]} ${parts[0]}`;
  const postcodePart = parts.find((part) => part.includes(postcode)) || '';
  let city = postcodePart.replace(postcode, '').trim();
  if (!city && postcode) {
    const postcodeIndex = parts.findIndex((part) => part.includes(postcode));
    const candidates = parts.slice(1, postcodeIndex).filter((part) => !/belgi|belgique|belgië|vlaanderen|wallonie|brussel-hoofdstad|bruxelles-capitale/i.test(part));
    city = candidates[candidates.length - 1] || '';
  }
  return { primary, secondary: [postcode, city].filter(Boolean).join(' '), full };
}

export function AddressText({ address, label, compact = false }: { address: string; label?: string | null; compact?: boolean }) {
  const presented = formatBelgianAddress(address, label);
  return <span className={`address-text ${compact ? 'address-text--compact' : ''}`} title={presented.full}>
    <strong>{presented.primary}</strong>
    {presented.secondary && <small>{presented.secondary}</small>}
  </span>;
}

export function CountLabel({ count, one, many }: { count: number; one: string; many: string }) {
  return <>{count} {count === 1 ? one : many}</>;
}

export function FriendlyRouteIllustration() {
  return <div className="friendly-route-illustration" aria-hidden="true"><BusAvatar size={66} /><span className="friendly-route-illustration__path" /><MapPin /></div>;
}

export function HonestMapState({ title, body }: { title: string; body: string }) {
  return <section className="honest-map-state"><MapPinned aria-hidden="true" /><h2>{title}</h2><p>{body}</p></section>;
}
