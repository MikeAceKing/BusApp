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
| User profile | `bus_app_profiles`, created on first authenticated call; no tenant or workspace record required |
| Avatars | Built-in SVG set is the default; an optional private photo is stored as a server-sanitized WebP asset |

## Privacy and authorization

- All 25 domain tables (22 V2 plus 3 added by V2.1) have RLS enabled and direct browser writes revoked.
- Only `bus_app_parent_trip_updates`, `bus_app_notifications` and `bus_app_avatar_updates` are browser-readable, with `user_id = auth.uid()` policies.
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

- V2 migrations: `20260830220000_bus_app_v2_neutral_foundation.sql` and `20260831003000_bus_app_v2_location_event_speed.sql`.
- V2.1 migrations: `20260831013000_bus_app_v2_avatar_styles.sql`, `20260831054000_bus_app_profiles_and_private_avatars.sql` and
  `20260831055000_bus_app_avatar_reference_guard_fix.sql`. All three are additive; `055000` only replaces the trigger function body from `054000`.
- Functions: `bus-app` and `bus-app-media`; `school-bus` remains active.
- V2.2 migration: `20260831120000_bus_app_bus_profile_permission.sql`, materializing `MANAGE_BUS_PROFILE` on existing members.
- Verified applied on production 2026-08-31: all V2.1 and V2.2 migrations are in `supabase_migrations.schema_migrations`,
  `bus-app` and `bus-app-media` are deployed, and `busapp.wexio.be` serves the matching build.
  One unrelated pending migration (`20260830120000_notification_web_push_typed_target`) was deliberately left unapplied.
- Anonymous Supabase users are enabled for parent devices.
- `BUS_APP_CODE_HASH_SECRET` and existing VAPID push secrets are configured server-side.
- CORS preflight from `https://busapp.wexio.be` returns 204 with the exact allowed origin.
- Rollback does not require deleting V2 data: restore the previous BusApp frontend/API slug and keep the additive V2 tables dormant.

## V2.1 — canonical profiles and private photos

Built-in avatars stay the default and the final fallback. A photo is optional and never replaces the identity model.

- Upload path is a separate `bus-app-media` Edge function. It never trusts the client: it authenticates the bearer token,
  then derives authority per owner — the caller's own profile, `OWNER`/`ATTENDANT` for a passenger, `OWNER` for a bus,
  and for a parent a live grant resolved through `bus_app_parent_grants` → `bus_app_parent_access` → `bus_app_parent_access_passengers`.
- Every upload is re-encoded server-side by ImageMagick WASM: magic bytes must match the declared type, animations are rejected,
  the image is cropped and resized to a fixed aspect, `strip()` removes all metadata, and only WebP is written out.
  The `magick.wasm` binary is pinned beside the function so the hosted bundle cannot lose it during dependency graph rewriting.
- `bus-app-private-media` is a private bucket limited to 5 MB and `image/webp`. Photos are served only as 300-second signed
  URLs for the thumbnail; no code path produces a public URL.
- `bus_app_avatar_assets` carries exactly one owner (`num_nonnulls(profile_user_id, passenger_id, bus_id) = 1`), a scope
  trigger ties passenger/bus assets to their Bus Space, and a reference trigger refuses an avatar pointing at an asset that
  is not its own and `ACTIVE`. Replacing a photo retires the old asset and deletes both stored objects.
- Reference updates are optimistically concurrent on `avatar_version`; a lost race returns `AVATAR_CONFLICT` rather than
  overwriting. A failed reference update rolls back both the asset row and the stored objects.
- `bus_app_profiles`, `bus_app_avatar_assets` and `bus_app_avatar_updates` have RLS enabled and are revoked from `anon`
  and `authenticated`. The only grant to `authenticated` is `select` on `bus_app_avatar_updates`, restricted to `user_id = auth.uid()`.
- Refresh is a coordinate-free, user-targeted realtime pulse: the server inserts one `bus_app_avatar_updates` row per
  authorized recipient, both clients subscribe filtered on their own `user_id`, and the rows expire after 24 hours.

## Verification evidence

- TypeScript/Vite production build passes.
- Deno Edge typecheck passes for `bus-app` and `bus-app-media`.
- Twelve `tests/server/bus-app-v2-contract.test.mjs` security/lifecycle contract tests pass, four of them covering the V2.1 profile, private-media and avatar-pulse invariants.
- Eighteen Playwright viewport/localization tests cover 320×568 through 768×1024, NL/FR, landscape, 200% inherited text, overloaded content, route, and filtered parent views.
- Screenshots are stored in `artifacts/bus-app-v2`.
- A production smoke run creates and removes temporary users/data while verifying Bus Space creation, stop/passenger creation, automatic route, immutable trip, GPS, attendance, anonymous parent grant, filtered parent payload, private profile and passenger photo upload, the parent bus profile DTO, and the resolved bus profile permission. It passed on 2026-08-31.

## Remaining technical debt

- Replace estimated local geometry with a monitored road-network OSRM/VROOM deployment before presenting turn-by-turn or road-exact ETAs.
- Add staff invitation UI when multi-staff onboarding becomes a product requirement; the membership/permission model is already extensible.
- Add per-event notification preferences if users need to mute specific event types. Current critical trip events are enabled by default.
- Retired (`REPLACED`) avatar asset rows are kept as an audit trail after their storage objects are deleted. Add a retention
  sweep if that history stops being useful.
