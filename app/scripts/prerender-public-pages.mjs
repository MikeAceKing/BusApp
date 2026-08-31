#!/usr/bin/env node
// Gives each public page its own HTML file with a correct title, description, canonical and
// Open Graph block.
//
// BusApp is a single-page app: without this, every route would share index.html and a static
// canonical would wrongly point every page at "/". The app's authenticated screens are
// client-side state at "/", not distinct URLs, so anything that is not a known public path
// falls through to index.html — which canonicalises to "/" so a crawler consolidates
// /login, /app and friends into the home page instead of indexing duplicates.
//
// Usage: node scripts/prerender-public-pages.mjs   (runs as part of npm run build)

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const origin = 'https://busapp.wexio.be';
const dist = new URL('../dist/', import.meta.url);

// Titles and descriptions are Dutch, matching the default document language. The same URL
// serves French client-side, so no separate language URLs are invented and no hreflang is
// claimed: hreflang describes alternate URLs, and BusApp has none.
const pages = [
  { path: '/', file: 'index.html', title: 'BusApp — Gratis busapp voor chauffeur, begeleider en ouders',
    description: 'Organiseer haltes en passagiers, bereid je busrit voor en geef ouders veilige toegang tot relevante businformatie. Gratis, in het Nederlands en Frans.' },
  { path: '/how', file: 'how.html', title: 'Hoe werkt BusApp? — BusApp',
    description: 'Van bus aanmaken tot haltes, route voorbereiden en oudertoegang delen. In vier stappen uitgelegd voor chauffeurs en begeleiders.' },
  { path: '/parents', file: 'parents.html', title: 'BusApp voor ouders — BusApp',
    description: 'Met een buscode van de chauffeur zie je jouw passagier, jouw halte en de relevante businformatie. Geen account nodig, geen tracking van je kind.' },
  { path: '/privacy', file: 'privacy.html', title: 'Privacy bij BusApp — BusApp',
    description: 'Volg de bus, niet de kinderen. Hoe BusApp met zo weinig mogelijk persoonlijke gegevens werkt, waar ze worden opgeslagen en wat ouders wel en niet zien.' },
  { path: '/help', file: 'help.html', title: 'Handleiding en hulp — BusApp',
    description: 'Registratie en eerste stappen: een visuele handleiding voor chauffeurs en begeleiders, met schermafbeeldingen en de volledige PDF-gids.' },
];

const template = readFileSync(fileURLToPath(new URL('index.html', dist)), 'utf8');

function replaceTag(html, pattern, replacement) {
  if (!pattern.test(html)) throw new Error(`prerender: expected to find ${pattern} in index.html`);
  return html.replace(pattern, replacement);
}

for (const page of pages) {
  const url = `${origin}${page.path}`;
  let html = template;
  html = replaceTag(html, /<title>[^<]*<\/title>/, `<title>${page.title}</title>`);
  html = replaceTag(html, /<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${page.description}" />`);
  // The whole point of this step: a per-page canonical instead of one shared URL.
  html = replaceTag(html, /<meta name="robots" content="[^"]*" \/>/, `<meta name="robots" content="index,follow" />\n    <link rel="canonical" href="${url}" />`);
  html = replaceTag(html, /<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${page.title}" />`);
  html = replaceTag(html, /<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${page.description}" />`);
  html = replaceTag(html, /<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${url}" />`);
  writeFileSync(fileURLToPath(new URL(page.file, dist)), html);
  console.log(`  ${page.path.padEnd(10)} -> dist/${page.file}`);
}

const lastmod = new Date().toISOString().slice(0, 10);
const urls = pages
  .map((page) => `  <url><loc>${origin}${page.path}</loc><lastmod>${lastmod}</lastmod><changefreq>monthly</changefreq><priority>${page.path === '/' ? '1.0' : '0.7'}</priority></url>`)
  .join('\n');
const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  urls,
  '</urlset>',
  '',
].join('\n');
writeFileSync(fileURLToPath(new URL('sitemap.xml', dist)), sitemap);
console.log(`  sitemap.xml with ${pages.length} public URLs`);
