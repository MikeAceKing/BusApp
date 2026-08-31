import { ArrowRight, BusFront, Check, FileText, Globe, KeyRound, ShieldCheck, Smartphone, Sparkles, UsersRound } from 'lucide-react';
import type { EntryMode, Locale } from '../types';
import { Brand, FriendlyBus, LanguageSwitch, createT } from './Shared';
import { guideDocument, guideShots, publicCopy } from '../public-content';
import { usePublicPath, type PublicPath } from '../public-routes';

// The public site is a small set of real pages, not one long scroll. It reuses the existing
// runtime for authentication: a CTA only chooses an entry mode, it never duplicates a login
// form, and no map or routing code is loaded here.
export function PublicIntro({ locale, onLocale, onSelect }: { locale: Locale; onLocale: (locale: Locale) => void; onSelect: (mode: EntryMode) => void }) {
  const t = createT(locale);
  const [path, navigate] = usePublicPath();
  const say = <T extends Record<Locale, string>>(entry: T) => entry[locale];

  const nav: Array<{ path: PublicPath; label: string }> = [
    { path: '/how', label: say(publicCopy.navHowItWorks) },
    { path: '/parents', label: say(publicCopy.navParents) },
    { path: '/privacy', label: say(publicCopy.navPrivacy) },
    { path: '/help', label: say(publicCopy.navGuide) },
  ];
  const link = (to: PublicPath) => ({ href: to, onClick: (event: React.MouseEvent) => { event.preventDefault(); navigate(to); } });

  const startButtons = <div className="public-hero__actions">
    <button className="primary-button button-with-icon" onClick={() => onSelect('BUS')}><BusFront aria-hidden="true" />{say(publicCopy.ctaStart)}</button>
    <button className="secondary-button button-with-icon" onClick={() => onSelect('PARENT')}><UsersRound aria-hidden="true" />{say(publicCopy.ctaParent)}</button>
  </div>;

  const shots = (from: number, to: number) => <div className="public-journey">
    {guideShots.slice(from, to).map((shot, index) => <figure key={shot.src}>
      <div className="public-shot">
        <img src={shot.src} width={shot.width} height={shot.height} alt={say(shot.alt)} loading={from === 0 && index === 0 ? 'eager' : 'lazy'} decoding="async" />
      </div>
      <figcaption><strong>{say(shot.title)}</strong><p>{say(shot.body)}</p></figcaption>
    </figure>)}
  </div>;

  return <main className="public-intro">
    <header className="public-intro__bar">
      <a className="public-brand-link" {...link('/')} aria-label="BusApp"><Brand /></a>
      <nav aria-label={say(publicCopy.navHowItWorks)}>
        {nav.map((item) => <a key={item.path} {...link(item.path)} aria-current={path === item.path ? 'page' : undefined}>{item.label}</a>)}
      </nav>
      <LanguageSwitch locale={locale} onChange={onLocale} />
    </header>

    {path === '/' && <>
      <section className="public-hero">
        <div className="public-hero__art" aria-hidden="true">
          <i className="public-hero__sun" /><i className="public-hero__cloud" />
          <FriendlyBus size={168} />
        </div>
        <h1>{say(publicCopy.heroTitle)}</h1>
        <p>{say(publicCopy.heroBody)}</p>
        {startButtons}
        <ul className="public-badges">
          <li><Globe aria-hidden="true" />{say(publicCopy.badgeLanguages)}</li>
          <li><BusFront aria-hidden="true" />{say(publicCopy.badgeCountry)}</li>
          <li><Smartphone aria-hidden="true" />{say(publicCopy.badgeMobile)}</li>
          <li><ShieldCheck aria-hidden="true" />{say(publicCopy.badgePrivacy)}</li>
          <li><Sparkles aria-hidden="true" />{say(publicCopy.badgeFree)}</li>
        </ul>
      </section>

      <section className="public-section">
        <h2>{say(publicCopy.whatTitle)}</h2>
        <p>{say(publicCopy.whatBody)}</p>
      </section>

      <section className="public-promise">
        <ShieldCheck aria-hidden="true" />
        <div><h2>{say(publicCopy.promiseTitle)}</h2><p>{say(publicCopy.promiseBody)}</p></div>
      </section>

      <section className="public-section">
        <h2>{say(publicCopy.howTitle)}</h2>
        <ol className="public-steps">
          {publicCopy.steps.map((step, index) => <li key={step.nl.title}>
            <b aria-hidden="true">{index + 1}</b>
            <div><strong>{step[locale].title}</strong><p>{step[locale].body}</p></div>
          </li>)}
        </ol>
        <a className="public-more button-with-icon" {...link('/how')}>{say(publicCopy.navHowItWorks)}<ArrowRight aria-hidden="true" /></a>
      </section>
    </>}

    {path === '/how' && <>
      <section className="public-section">
        <h1>{say(publicCopy.howTitle)}</h1>
        <ol className="public-steps">
          {publicCopy.steps.map((step, index) => <li key={step.nl.title}>
            <b aria-hidden="true">{index + 1}</b>
            <div><strong>{step[locale].title}</strong><p>{step[locale].body}</p></div>
          </li>)}
        </ol>
      </section>
      <section className="public-section">
        <h2>{say(publicCopy.staffTitle)}</h2>
        <p>{say(publicCopy.staffBody)}</p>
        <ul className="public-list">{publicCopy.staffPoints.map((point) => <li key={point.nl}><Check aria-hidden="true" />{say(point)}</li>)}</ul>
      </section>
      <section className="public-section">
        {shots(0, 5)}
        <a className="public-more button-with-icon" {...link('/help')}>{say(publicCopy.navGuide)}<ArrowRight aria-hidden="true" /></a>
      </section>
      <section className="public-final">{startButtons}</section>
    </>}

    {path === '/parents' && <>
      <section className="public-section">
        <h1>{say(publicCopy.parentTitle)}</h1>
        <p>{say(publicCopy.parentBody)}</p>
        <ul className="public-list">{publicCopy.parentPoints.map((point) => <li key={point.nl}><Check aria-hidden="true" />{say(point)}</li>)}</ul>
      </section>
      <section className="public-promise">
        <ShieldCheck aria-hidden="true" />
        <div><h2>{say(publicCopy.promiseTitle)}</h2><p>{say(publicCopy.promiseBody)}</p></div>
      </section>
      <section className="public-section">
        <aside className="public-trust"><ShieldCheck aria-hidden="true" /><div><strong>{say(publicCopy.parentTrustTitle)}</strong><p>{say(publicCopy.parentTrustBody)}</p></div></aside>
        <button className="primary-button button-with-icon" onClick={() => onSelect('PARENT')}><KeyRound aria-hidden="true" />{say(publicCopy.ctaParent)}</button>
      </section>
    </>}

    {path === '/privacy' && <>
      <section className="public-section">
        <h1>{say(publicCopy.privacyTitle)}</h1>
        <p>{say(publicCopy.privacyBody)}</p>
        <ul className="public-list">{publicCopy.privacyPoints.map((point) => <li key={point.nl}><Check aria-hidden="true" />{say(point)}</li>)}</ul>
      </section>
      <section className="public-promise">
        <ShieldCheck aria-hidden="true" />
        <div><h2>{say(publicCopy.promiseTitle)}</h2><p>{say(publicCopy.promiseBody)}</p></div>
      </section>
      <section className="public-section">
        <h2>{say(publicCopy.storageTitle)}</h2>
        <p>{say(publicCopy.storageBody)}</p>
        <p className="public-fineprint">{say(publicCopy.gdprBody)}</p>
      </section>
    </>}

    {path === '/help' && <>
      <section className="public-section">
        <h1>{say(publicCopy.guideTitle)}</h1>
        <article className="public-guide">
          <FileText aria-hidden="true" />
          <div>
            <strong>{say(publicCopy.guideHeading)}</strong>
            <p>{say(publicCopy.guideBody)}</p>
            <small>{say(publicCopy.guideMeta)}</small>
            <a className="secondary-button button-with-icon" href={guideDocument.href} target="_blank" rel="noopener noreferrer"><FileText aria-hidden="true" />{say(publicCopy.guideOpen)}</a>
          </div>
        </article>
      </section>
      <section className="public-section">
        <h2>{say(publicCopy.journeyTitle)}</h2>
        {shots(0, guideShots.length)}
      </section>
      <section className="public-section">
        <h2>{say(publicCopy.busProfileTitle)}</h2>
        <p>{say(publicCopy.busProfileBody)}</p>
        <h2>{say(publicCopy.profileTitle)}</h2>
        <p>{say(publicCopy.profileBody)}</p>
      </section>
    </>}

    {path !== '/parents' && <section className="public-final">
      <h2>{say(publicCopy.freeTitle)}</h2>
      <p>{say(publicCopy.freeBody)}</p>
      {startButtons}
    </section>}

    <footer className="public-footer">
      <strong>BusApp by Wexio</strong>
      <p>{say(publicCopy.footerTagline)}</p>
      <div className="public-footer__links">
        {nav.map((item) => <a key={item.path} {...link(item.path)}>{item.label}</a>)}
        <a href="mailto:admin@wexio.be">{say(publicCopy.contactTitle)}</a>
      </div>
      <address>Michael Martin Belber · admin@wexio.be · +32 473 46 15 01</address>
      <LanguageSwitch locale={locale} onChange={onLocale} />
      <p className="public-fineprint">{t('freePromise')}</p>
    </footer>
  </main>;
}
