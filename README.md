# BusApp

Free, privacy-first bus route companion for Belgium. BusApp lets a driver create a bus, add stops and passengers, prepare a route and start a trip. Parents open a restricted view with a revocable code; no parent email is required.

Production: [busapp.wexio.be](https://busapp.wexio.be)

## Current status

Audited against production on 2026-08-31.

| Area | State |
|---|---|
| Public site | Live, five pages, complete in NL and FR |
| Accounts, buses, stops, passengers | Live |
| Parent access by code | Live, anonymous session, no parent email |
| Profiles and private photos | Live |
| Trips, attendance, bus GPS | Live |
| Map basemap | Live: MapLibre + OpenFreeMap, no API key |
| Road routing | **Not activated.** `ROUTING_PROVIDER` is unset, so routing runs on the local heuristic and every distance and duration is shown as an estimate |
| Search engine indexing | Disabled (`robots: noindex` in `app/index.html`) |

Verified in production: 26 `bus_app_*` tables, row level security enabled on all of them,
no `INSERT`/`UPDATE`/`DELETE` granted to `anon` or `authenticated` on any of them, and only
three tables readable by a browser at all — `bus_app_parent_trip_updates`,
`bus_app_notifications` and `bus_app_avatar_updates`, each restricted to `user_id = auth.uid()`.
The media bucket is private, capped at 5 MiB and limited to `image/webp`.

Because road routing is not activated, the product deliberately does not claim exact routes,
live traffic or navigation anywhere in its interface. A test enforces that.

## Public introduction & guide

Visiting BusApp without an account opens a small public site that explains the product
before anyone registers. It is a set of real pages, not one long scroll:

```text
/          what BusApp is, the privacy promise, the four steps
/how       how it works, and what a driver or attendant gets
/parents   what a parent receives, and what they do not
/privacy   privacy by design, technical storage, GDPR wording
/help      the guide, plus the full screenshot walkthrough
/docs/BusApp_Registratie_Eerste_Stappen.pdf
```

Everything is complete in Dutch and French, and the language switch works before
authentication. The public site loads no map and no routing code — MapLibre stays in its
own lazy chunk that a visitor never fetches.

The screenshots in `app/public/media/guide/` and the guide in `app/public/docs/` are
approved public product materials: real, unmodified screenshots of the current app showing
a test account and an empty test bus. They contain no user data, no access codes and no
tokens. The guide is written in Dutch (the app interface is NL/FR), and the site labels it
as such rather than implying it is bilingual.

A returning visitor who has already chosen an access route goes straight to the compact
picker, and an authenticated session — including an installed PWA — opens BusApp directly
without passing through the public site.

Note: the site currently sends `robots: noindex`. Change that meta tag in `app/index.html`
to publish it to search engines; the SEO and Open Graph metadata is already in place.

## Core principles

- Follow the bus, not the child.
- The driver creates and controls the bus.
- Stops are real geocoded addresses, not demo data.
- Parents see only their granted passengers, their own stop and reduced bus telemetry.
- Parent access uses a revocable code and an anonymous Supabase Auth session.
- Dutch and French are first-class languages.
- The interface is mobile/tablet first and installable as a PWA.
- BusApp is free; no tenant, school, company or subscription is required.

## Repository scope

This repository contains BusApp only:

```text
app/                               React/Vite PWA
app/public/media/guide/            Approved product screenshots
app/public/media/hero/             Generated hero images
app/public/brand/                  Source logo and hero, plus the generated wordmark
app/public/docs/                   Public PDF guide
supabase/functions/bus-app/        Domain Edge Function
supabase/functions/bus-app-media/  Isolated image upload/sanitising function
supabase/migrations/               BusApp database/RLS migrations
scripts/                           Asset generation and deploy helpers
docs/                              Product and security audits
tests/                             Static security and product contracts
```

It intentionally excludes SBCOS, NAVI/Luna, other Wexio products, tenant data, production dumps and deployment credentials. The Edge Function relies on Supabase Auth and the Supabase platform-provided URL, anonymous key and service-role key. Those values are never committed.

## Architecture

The browser talks only to the dedicated `bus-app` Edge Function for privileged operations. The function authenticates users, verifies Bus Space membership or parent grants, performs mutations with idempotency keys and writes audit events. Sensitive tables have RLS enabled and direct browser mutations are revoked. Realtime exposes only user-targeted parent, trip and avatar pulses plus notification rows.

The primary domain is:

```text
driver -> Bus Space -> bus -> stops -> passengers -> route plan -> trip
parent code -> anonymous session -> restricted parent grant
```

## Map and routing

The map is [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/) rendering the free
[OpenFreeMap](https://openfreemap.org) `liberty` style. OpenFreeMap needs no API key and no
registration, so its style URL is safe in the browser bundle — a public style URL is not a
secret. The style provider is centralised in `app/src/map-config.ts`, so moving to
Protomaps/PMTiles, MapTiler or a self-hosted style is a configuration change only.

MapLibre is about a megabyte, so it is loaded lazily: the map renderer is fetched only when
a map is actually shown, keeping the initial bundle small for a phone in a vehicle.

**The map is never the only source of route information.** Distance, duration, ordered stops,
next stop and ETA are always available as text, and a tile outage never blocks attendance,
the next stop or GPS recording.

### Required Content-Security-Policy

MapLibre decodes tiles in a worker created from a blob URL, and fetches the style, glyphs,
sprites and vector tiles from the tile host. The site CSP must therefore allow both:

```text
worker-src 'self' blob:;
connect-src 'self' <supabase origins> https://tiles.openfreemap.org;
img-src 'self' data: blob: https://tiles.openfreemap.org;
```

Without `worker-src`, `script-src` is used as a fallback and the map cannot start at all.
The production smoke asserts these headers against the deployed site, because a preview
server sends no CSP and so cannot catch a regression here.

## Routing providers

The routing layer is provider-based:

- `local` is the current safe fallback. It estimates ordering, distance and duration and is always labelled as an estimate.
- `openrouteservice` is the intended road provider, on the current HeiGIT host
  `https://api.heigit.org`. The former `api.openrouteservice.org` was deprecated on
  2026-04-28, reduced to 10% quota on 2026-08-27 and shuts down on 2026-09-28; existing keys
  carry over. The base URL stays configurable via `OPENROUTESERVICE_BASE_URL`.
  The routing API key is server-side only and is never exposed to the browser.
- `osrm` accepts road geometry only when the provider returns actual GeoJSON geometry.
- `vroom` optimizes stop order. Its waypoint geometry is not presented as a road map.

No simulated grid or invented route polyline is rendered. If road geometry is unavailable, the UI says that the map is unavailable.

Relevant Edge Function variables:

```text
ROUTING_PROVIDER=local|openrouteservice|osrm|vroom
OPENROUTESERVICE_API_KEY=            # server-side only, never in the browser bundle
OPENROUTESERVICE_BASE_URL=           # defaults to https://api.heigit.org
OPENROUTESERVICE_PROFILE=            # defaults to driving-car
OPENROUTESERVICE_MAX_WAYPOINTS=      # defaults to the published limit of 50
OSRM_BASE_URL=
VROOM_BASE_URL=
GEOCODING_PROVIDER=nominatim|openrouteservice|mapbox
GEOCODING_COUNTRIES=                 # defaults to BE,FR
NOMINATIM_BASE_URL=
BUS_APP_GEOCODING_CONTACT=
```

Nothing above is required to run BusApp: with no routing variables set the provider
resolves to `local` and every distance and duration is labelled as an estimate.

## Privacy model

- Parent codes are stored as HMAC hashes, never as plaintext.
- Code activation is rate-limited and deliberately timing-padded.
- Codes can be regenerated or revoked.
- A parent response is filtered to explicitly granted passenger IDs and their stop IDs.
- Parent bus coordinates are rounded and contain no passenger or child location.
- Live trip data expires and is cleared after terminal trip states.
- An external routing provider receives coordinates and an ephemeral positional index only.
  No passenger, parent, Bus Space or user identifier ever leaves the server, and a test
  asserts this against the outgoing request body.
- Route calculation requires the `MANAGE_ROUTE` Bus Space permission, and address search is
  closed to anonymous parent devices, so a parent cannot spend the shared provider quota.
- Provider call metering lives in its own expiring table, not in the durable audit log.
- Service-role credentials remain server-side.

## Identities: person, bus and passenger

BusApp keeps three separate identities and never conflates them.

- **A personal profile is a person.** `bus_app_profiles` holds one canonical profile per authenticated user: a display name they choose, a language and an avatar. A driver, an attendant and a parent all use the same profile authority; only their Bus Space role differs. A profile is never seeded from a bus or Bus Space name.
- **A bus profile is the vehicle.** Its name, avatar and photo live on the bus record and appear identically on every screen that shows that bus.
- **A passenger profile is the passenger.** One canonical avatar, shared by everyone authorised to see it.

Profiles open in read mode. Editing is an explicit step — *Profiel aanpassen* / *Modifier le profil*, *Bus aanpassen* / *Modifier le bus*, *Avatar aanpassen* / *Modifier l'avatar* — and ends with a labelled Cancel/Save pair.

Editing the bus profile is governed by the `MANAGE_BUS_PROFILE` Bus Space permission. The server resolves it from the stored member record, falling back to the role default when no explicit grant or denial is recorded; a client-supplied role is never consulted.

## Passenger avatar synchronization

There is exactly one passenger avatar. No per-audience copy exists — no `parent_avatar`, no `staff_avatar`.

```text
parent updates the avatar  ─┐
                            ├─> canonical passenger record ─> user-targeted realtime pulse ─> the other side refreshes
authorised staff updates it ─┘
```

Both directions write the same row through the same server helper, and the pulse fans out to every active Bus Space member and to every parent holding a live grant for that passenger. Neither side can drift.

## Parent-visible bus identity

**Parent users only receive the bus and staff profile information required for their own active transport context.**

A parent can open the bus they are actually assigned to and see its name, its avatar or photo, the current trip status, their own stop, and the display name, role and avatar of the driver and attendant. The server resolves that from the parent's own grant — grant → passenger → stop → bus → that bus's members — and builds a named DTO. There is no parent-facing membership, driver or bus listing endpoint, and the payload carries no email, phone number, user identifier, permission set or any other bus.

## Profiles, avatars and language

BusApp has one canonical profile per authenticated user and one canonical avatar per passenger or bus. Built-in assets are original local SVG illustrations: 24 child avatars, 8 adult avatars and 6 bus avatars. A private uploaded photo can replace an illustration; selecting another illustration safely retires the former upload.

The visible NL/FR profile switch controls the current interface immediately and persists to both the browser and the canonical user profile. This is deliberately separate from the Bus Space default language, which controls operational bus notifications.

Photos are uploaded only to the isolated `bus-app-media` function. It verifies authorization and the real file signature, limits input to 5 MiB, rejects active/vector/document formats, removes metadata and re-encodes a square profile/passenger image or 4:3 bus image as WebP. Originals are never stored. The private bucket is served through short-lived signed thumbnail URLs with a built-in/initials fallback.

## Brand assets

Every icon and hero image is generated from a single source file, so the brand cannot drift
apart. Both scripts use the already-pinned `@imagemagick/magick-wasm` dependency, so no extra
image toolchain is needed.

```bash
node scripts/generate-brand-icons.mjs   # from app/public/brand/buslogo-source.png
node scripts/generate-hero-images.mjs   # from app/public/brand/herobus-source.png
```

The icon script produces the PWA icons, the Apple touch icon, two favicon sizes and the
in-app wordmark. Maskable and Apple icons are flattened onto the brand blue with the artwork
inset to the 80% safe zone, so a circular or squircle mask cannot clip the bus or expose
transparent corners. Every icon is padded to an exact square, because a manifest that
declares 192x192 must actually receive that size.

The hero script art-directs rather than merely scaling: phones get a 3:2 crop centred on the
bus, tablet and desktop get the full 1916x821 banner, each at three widths in WebP.

A test asserts every precached service-worker asset exists. Renaming a brand file without
updating the shell list would make `cache.addAll()` reject as a whole and leave installed
apps with no service worker.

## Local development

Requirements: Node.js 20+, npm, a Supabase project and the current Supabase CLI through `npx supabase`.

```bash
npm install
cp app/.env.example app/.env.local
npm run dev
```

Configure only the public browser values in `app/.env.local`:

```text
VITE_SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
```

Never put `SUPABASE_SERVICE_ROLE_KEY`, `BUS_APP_CODE_HASH_SECRET`, web-push private keys or database credentials in a frontend environment file.

## Backend environment

Supabase provides `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` to the Edge runtime. Configure these additional secrets in the target Supabase project, not in Git:

```text
BUS_APP_CODE_HASH_SECRET
CORS_ALLOWED_ORIGINS
WEB_PUSH_SUBJECT
WEB_PUSH_PUBLIC_KEY
WEB_PUSH_PRIVATE_KEY
```

Routing/geocoding variables are optional; the local estimate and Nominatim defaults remain available.

## Build and tests

```bash
npm run build
npm test
```

The build blocks emoji product glyphs and simulated-map runtime classes.

- **42 contract tests** (`npm run test:contracts`) read the migrations, Edge functions and
  UI source directly and assert the invariants that matter: RLS and browser grants, parent
  payload filtering, the canonical passenger avatar, image sanitising, the routing provider
  abstraction and geometry integrity, the icon and service-worker shell, and that no
  provider secret appears in any built bundle.
- **46 browser tests** (`npm run test:responsive`) cover both languages at 320-430 px, tablet
  at 768 and 820 px, landscape, 200% text sizing, horizontal overflow, the public pages and
  their deep links, hero art direction, and that the public site never fetches the map chunk.

A production smoke run (`node app/scripts/production-smoke.mjs`, with `SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`) exercises the live system end to end
with temporary users and data that it removes afterwards. It also asserts the deployed
Content-Security-Policy still allows the map, which a preview server cannot catch.

A read-only maintenance report is available for profiles whose display name looks like it was seeded from a bus name by the earlier fallback. It never writes; affected users can simply edit their own profile.

```bash
npm run audit:profile-names --workspace app
```

Install the Playwright Chromium runtime once when needed:

```bash
npx playwright install chromium
```

## Deployment overview

Link the intended Supabase project, inspect migration ordering, then deploy only the BusApp resources:

```bash
npx supabase migration list
npx supabase db push --dry-run          # read this: db push applies EVERY pending migration
npx supabase db push
node scripts/fetch-magick-wasm.mjs      # restores the ~14 MB WASM the media function needs
npx supabase functions deploy bus-app
npx supabase functions deploy bus-app-media
npm run build
```

`db push` applies every pending migration in the linked project, not only BusApp's. If the
project also hosts other products, check the dry run and apply the BusApp migrations
individually rather than pushing the whole backlog.

`supabase/functions/bus-app-media/magick.wasm` is a ~14 MB build artifact extracted from the pinned `@imagemagick/magick-wasm` dependency. It is deliberately not committed; `scripts/fetch-magick-wasm.mjs` copies it from `node_modules` so the deployed bundle cannot lose the binary during dependency graph rewriting.

Publish `app/dist/` behind the BusApp host. Configure `CORS_ALLOWED_ORIGINS` with the exact production and local development origins. Verify the Edge health endpoint, PWA assets, browser console and the end-to-end driver/parent smoke flow after deployment.

The migration files preserve the production baseline history. The first baseline migration contains a guarded comment for installations where the former rollback table is absent; it does not create or depend on that domain.

## License

LICENSE DECISION REQUIRED. This public repository currently has no license; viewing the source does not grant reuse, modification or distribution rights.
