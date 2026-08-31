# BusApp V2 — domain and rollout audit

Date: 2026-08-31
Production scope: `busapp.wexio.be` only

## Outcome

BusApp V2 is a neutral bus coordination product. Its authority is a `Bus Space`, created by a permanent staff account. It does not require a school, company, tenant, organization, subscription, or a pre-existing Wexio workspace.

The legacy `school_bus_*` tables and `school-bus` Edge function remain deployed and unchanged as rollback infrastructure. V2 uses new `bus_app_*` tables, the `bus-app` Edge function, a separate browser auth storage key, and a separate PWA cache.

## Mandatory architecture audit

- Runtime shell: standalone BusApp PWA in `sites/busapp`; it is not a second SBCOS mobile runtime.
- Shared authority: Supabase Auth, one neutral Edge API, and the `bus_app_*` PostgreSQL domain.
- Scroll owner: `.page-content` is the only primary module scroll owner; header and bottom navigation belong to the BusApp shell.
- Safe areas and keyboard: the shell owns dynamic viewport/safe-area spacing; modules provide only content and actions.
- Desktop/tablet: presentation expands from available container width. No user-agent or device-name branching exists.
- Other Wexio apps: no shared desktop, NAVI, widget, tenant, notification-store, or marketing runtime was changed for this rollout.

## Domain decisions

| Concern | Decision |
|---|---|
| School-specific authority | Deprecated for V2; retained only in `school_bus_*` rollback domain |
| Bus identity | `bus_app_spaces` plus one active `bus_app_buses` record |
| Staff roles | `OWNER`, `DRIVER`, `ATTENDANT`; server-derived membership only |
| Parent identity | Supabase anonymous authenticated device plus a revocable server grant |
| Parent code | Random code shown once; only HMAC-SHA256 is stored |
| Passengers | Display name/avatar and assigned stop; no passenger authentication required |
| Location | Bus-trip telemetry only; no parent/passenger GPS columns |
| Route | Mutable plan; stop/address/passenger snapshot copied into an immutable trip |
| Notifications | Dedicated BusApp notification/push tables; filtered realtime pulses per authenticated user |
| Languages | NL and FR in the same runtime and data model |

## Privacy and authorization

- All 22 V2 domain tables have RLS enabled and direct browser writes revoked.
- Only `bus_app_parent_trip_updates` and `bus_app_notifications` are browser-readable, with `user_id = auth.uid()` policies.
- Every staff route derives access from `bus_app_members`; client-supplied roles are not trusted.
- A parent response is built from the exact parent grant → passenger links → those passengers' stops.
- Parent payloads omit the full route, other stops, other passengers, members, raw history, and driver session IDs.
- Parent-visible live coordinates are bus coordinates rounded to three decimals; no person coordinates exist.
- GPS events and realtime pulses expire after 24 hours; live GPS and history are removed when a trip completes or is cancelled.
- Parent code attempts are limited per anonymous device and per hashed IP. Success and failure responses have a minimum response duration.

## Routing decision

The provider interface supports local, OSRM, and VROOM adapters without changing UI or domain data.

Production currently uses `local_heuristic`: nearest-neighbour plus 2-opt for automatic stop order, with explicit estimated distance/time labeling. This is operational without adding a heavy routing service to the already shared VPS. It is not a road-network navigation engine.

The production upgrade path is to deploy a separately monitored OSRM/VROOM service and set `ROUTING_PROVIDER` plus its server-side base URL. No BusApp schema or frontend rewrite is required. Nominatim is used only after an explicit address-search action, is globally throttled, Belgium-filtered, and cached for 30 days; it is not used for keystroke autocomplete.

## Rollout and rollback

- Applied migrations: `20260830220000_bus_app_v2_neutral_foundation.sql` and `20260831003000_bus_app_v2_location_event_speed.sql` only.
- Deployed function: `bus-app`; `school-bus` remains active.
- Anonymous Supabase users are enabled for parent devices.
- `BUS_APP_CODE_HASH_SECRET` and existing VAPID push secrets are configured server-side.
- CORS preflight from `https://busapp.wexio.be` returns 204 with the exact allowed origin.
- Rollback does not require deleting V2 data: restore the previous BusApp frontend/API slug and keep the additive V2 tables dormant.

## Verification evidence

- TypeScript/Vite production build passes.
- Deno Edge typecheck passes.
- Seven V2 security/lifecycle contract tests pass.
- Eighteen Playwright viewport/localization tests cover 320×568 through 768×1024, NL/FR, landscape, 200% inherited text, overloaded content, route, and filtered parent views.
- Screenshots are stored in `artifacts/bus-app-v2`.
- A production smoke run creates and removes temporary users/data while verifying Bus Space creation, stop/passenger creation, automatic route, immutable trip, GPS, attendance, anonymous parent grant, and filtered parent payload.

## Remaining technical debt

- Replace estimated local geometry with a monitored road-network OSRM/VROOM deployment before presenting turn-by-turn or road-exact ETAs.
- Add staff invitation UI when multi-staff onboarding becomes a product requirement; the membership/permission model is already extensible.
- Add per-event notification preferences if users need to mute specific event types. Current critical trip events are enabled by default.
