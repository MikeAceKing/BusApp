# BusApp

Free, privacy-first bus route companion for Belgium. BusApp lets a driver create a bus, add stops and passengers, prepare a route and start a trip. Parents open a restricted view with a revocable code; no parent email is required.

Production: [busapp.wexio.be](https://busapp.wexio.be)

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
app/                         React/Vite PWA
supabase/functions/bus-app/  Dedicated Edge Function
supabase/migrations/         BusApp database/RLS migrations
docs/                        Product and security audits
tests/                       Static security and product contracts
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
ROUTING_PROVIDER=local|osrm|vroom
OSRM_BASE_URL=
VROOM_BASE_URL=
GEOCODING_PROVIDER=nominatim|mapbox
NOMINATIM_BASE_URL=
MAPBOX_ACCESS_TOKEN=
BUS_APP_GEOCODING_CONTACT=
```

## Privacy model

- Parent codes are stored as HMAC hashes, never as plaintext.
- Code activation is rate-limited and deliberately timing-padded.
- Codes can be regenerated or revoked.
- A parent response is filtered to explicitly granted passenger IDs and their stop IDs.
- Parent bus coordinates are rounded and contain no passenger or child location.
- Live trip data expires and is cleared after terminal trip states.
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

The build blocks emoji product glyphs and simulated-map runtime classes. Tests cover TypeScript, RLS/security contracts, honest map states, PWA assets, NL/FR, mobile widths from 320 to 430 px, tablet at 768 px, landscape, 200% text sizing and horizontal overflow.

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
npx supabase db push --dry-run
npx supabase db push
node scripts/fetch-magick-wasm.mjs
npx supabase functions deploy bus-app
npx supabase functions deploy bus-app-media
npm run build
```

`supabase/functions/bus-app-media/magick.wasm` is a ~14 MB build artifact extracted from the pinned `@imagemagick/magick-wasm` dependency. It is deliberately not committed; `scripts/fetch-magick-wasm.mjs` copies it from `node_modules` so the deployed bundle cannot lose the binary during dependency graph rewriting.

Publish `app/dist/` behind the BusApp host. Configure `CORS_ALLOWED_ORIGINS` with the exact production and local development origins. Verify the Edge health endpoint, PWA assets, browser console and the end-to-end driver/parent smoke flow after deployment.

The migration files preserve the production baseline history. The first baseline migration contains a guarded comment for installations where the former rollback table is absent; it does not create or depend on that domain.

## License

LICENSE DECISION REQUIRED. This public repository currently has no license; viewing the source does not grant reuse, modification or distribution rights.
