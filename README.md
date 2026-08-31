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

The browser talks only to the dedicated `bus-app` Edge Function for privileged operations. The function authenticates users, verifies Bus Space membership or parent grants, performs mutations with idempotency keys and writes audit events. Sensitive tables have RLS enabled and direct browser mutations are revoked. Realtime exposes only user-targeted parent pulses and notification rows.

The primary domain is:

```text
driver -> Bus Space -> bus -> stops -> passengers -> route plan -> trip
parent code -> anonymous session -> restricted parent grant
```

## Routing providers

The routing layer is provider-based:

- `local` is the current safe fallback. It estimates ordering, distance and duration and is always labelled as an estimate.
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
npx supabase functions deploy bus-app
npm run build
```

Publish `app/dist/` behind the BusApp host. Configure `CORS_ALLOWED_ORIGINS` with the exact production and local development origins. Verify the Edge health endpoint, PWA assets, browser console and the end-to-end driver/parent smoke flow after deployment.

The migration files preserve the production baseline history. The first baseline migration contains a guarded comment for installations where the former rollback table is absent; it does not create or depend on that domain.

## License

LICENSE DECISION REQUIRED. This public repository currently has no license; viewing the source does not grant reuse, modification or distribution rights.
