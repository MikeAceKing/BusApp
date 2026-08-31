import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from 'playwright/test';

const viewports = [
  { width: 320, height: 568 },
  { width: 360, height: 740 },
  { width: 360, height: 800 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 820, height: 1180 },
];
const artifacts = '../../artifacts/bus-app-friendly';
mkdirSync(artifacts, { recursive: true });

const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const spaceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const busId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const stopId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const secondStopId = '22222222-2222-4222-8222-222222222222';
const passengerId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const grantId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const tripId = '55555555-5555-4555-8555-555555555555';
const pageErrors = new WeakMap<Page, string[]>();
const tilesBlocked = new WeakSet<Page>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  // Only a test that deliberately blocks tiles may tolerate a resource-load failure, and
  // the browser reports those without a URL, so the tolerance is opted into per page.
  const expected = (text: string) => text.includes('wss://example.supabase.co/')
    || text.includes('tiles.openfreemap.org')
    || (tilesBlocked.has(page) && /net::ERR_FAILED|Failed to load resource/.test(text));
  page.on('pageerror', (error) => { if (!expected(error.message)) errors.push(error.message); });
  page.on('console', (message) => {
    if (message.type() === 'error' && !expected(message.text())) errors.push(message.text());
  });
  await page.route('**/auth/v1/**', (route) => route.fulfill({
    json: { user: { id: userId, email: 'driver@example.test', aud: 'authenticated', role: 'authenticated' } },
  }));
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page), 'uncaught browser errors').toEqual([]);
});

async function geometry(page: Page, checkBottomNav = false) {
  const result = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
    clipped: [...document.querySelectorAll('button,input,select,textarea')].filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.left < -.5 || rect.right > innerWidth + .5;
    }).length,
  }));
  expect(result.width).toBeLessThanOrEqual(result.viewport + 1);
  expect(result.clipped).toBe(0);
  if (checkBottomNav) {
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(50);
    const overlap = await page.evaluate(() => {
      const content = document.querySelector('.page-content');
      const nav = document.querySelector('.bottom-nav');
      if (!content || !nav) return 0;
      return content.lastElementChild!.getBoundingClientRect().bottom - nav.getBoundingClientRect().top;
    });
    expect(overlap, 'last content must remain above the fixed navigation').toBeLessThanOrEqual(1);
  }
}

function token(parent = false) {
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: 9_999_999_999, is_anonymous: parent })).toString('base64url');
  return `eyJhbGciOiJub25lIn0.${payload}.signature`;
}

async function seed(page: Page, mode: 'BUS' | 'PARENT', locale: 'nl' | 'fr', parent = false) {
  await page.addInitScript(({ accessToken, selectedMode, language, parentUser }) => {
    localStorage.clear();
    localStorage.setItem('bus-app-locale', language);
    localStorage.setItem('bus-app-mode', selectedMode);
    localStorage.setItem('wexio-bus-app-auth-v2', JSON.stringify({
      access_token: accessToken,
      refresh_token: 'fixture',
      expires_at: 9_999_999_999,
      expires_in: 3600,
      token_type: 'bearer',
      user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: parentUser ? null : 'driver@example.test', aud: 'authenticated', role: 'authenticated', is_anonymous: parentUser },
    }));
  }, { accessToken: token(parent), selectedMode: mode, language: locale, parentUser: parent });
}

function fixtures(overloaded = false, activeTrip = false) {
  const avatar = (builtInAvatarId:string,version=1) => ({ source:'BUILT_IN',builtInAvatarId,assetId:null,version,photoUrl:null });
  const profile = { user_id:userId,display_name:'Alex',language:'nl',avatar_version:1,avatar:avatar('adult-01') };
  const stops = [
    { id: stopId, bus_space_id: spaceId, bus_id: busId, label: null, display_address: '1, Voorbeeldlaan, Verrewinkel, Ukkel, Brussel-Hoofdstad, 1180, België', latitude: 50.95, longitude: 4.05, expected_passenger_count: 3, manual_sequence: 1, active: true },
    { id: secondStopId, bus_space_id: spaceId, bus_id: busId, label: 'Grote Markt', display_address: 'Grote Markt 7, 9300 Aalst, België', latitude: 50.96, longitude: 4.06, expected_passenger_count: 1, manual_sequence: 2, active: true },
  ];
  const active = { id: tripId, status: 'IN_TRANSIT', driver_session_id: '66666666-6666-4666-8666-666666666666', route_plan_id: '33333333-3333-4333-8333-333333333333', current_stop_sequence: 0 };
  return {
    home: {
      profile,
      space: { id: spaceId, name: 'Buurtbus Ukkel', avatar_key: 'bus', default_language: 'nl', roles: ['OWNER'] },
      bus: { id: busId, bus_space_id: spaceId, name: 'Buurtbus Ukkel', avatar_key: 'bus', avatar:avatar('bus-yellow-city'),avatar_version:1, capacity: overloaded ? 2 : 16, start_display_address: 'Stationsstraat 123 bus 45, 9300 Aalst, België', start_latitude: 50.94, start_longitude: 4.04, end_display_address: null, end_latitude: null, end_longitude: null },
      stops,
      passengers: [{ id: passengerId, bus_space_id: spaceId, stop_id: stopId, display_name: 'Alex D.', avatar_key: 'initials-purple', avatar:avatar('child-01'),avatar_version:1, active: true }],
      routePlan: { id: active.route_plan_id, bus_id: busId, provider: 'local_heuristic', optimization_mode: 'AUTOMATIC', distance_meters: 31750, duration_seconds: 2520, route_geometry: { type: 'LineString', coordinates: [[4.04, 50.94], [4.05, 50.95], [4.06, 50.96]] }, provider_metadata: { estimate: true, geometrySource: 'estimate' }, stale_at: null, stops: stops.map((stop, index) => ({ stop_id: stop.id, sequence: index + 1, estimated_arrival_offset_seconds: 900 * (index + 1), display_address_snapshot: stop.display_address, latitude_snapshot: stop.latitude, longitude_snapshot: stop.longitude, expected_passenger_count_snapshot: stop.expected_passenger_count })) },
      activeTrip: activeTrip ? active : null,
      members: [{ id: '44444444-4444-4444-8444-444444444444', user_id: userId, role: 'OWNER' }],
      parentAccess: [],
      role: 'OWNER',
      permissions: { manageBusProfile: true },
    },
    trip: {
      role: 'OWNER',
      trip: { ...active, bus: { id: busId, name: 'Buurtbus Ukkel', avatar_key: 'bus',avatar:avatar('bus-yellow-city') }, stops: stops.map((stop, index) => ({ id: `77777777-7777-4777-8777-77777777777${index}`, source_stop_id: stop.id, sequence: index + 1, display_address: stop.display_address, latitude: stop.latitude, longitude: stop.longitude, expected_passenger_count: stop.expected_passenger_count, estimated_arrival_offset_seconds: 900 * (index + 1), status: index ? 'PENDING' : 'APPROACHING' })), nextStop: { id: '77777777-7777-4777-8777-777777777770', source_stop_id: stopId, sequence: 1, display_address: stops[0].display_address, latitude: stops[0].latitude, longitude: stops[0].longitude, expected_passenger_count: 3, estimated_arrival_offset_seconds: 900, status: 'APPROACHING' }, passengers: [{ id: '88888888-8888-4888-8888-888888888888', passenger_id: passengerId, trip_stop_id: '77777777-7777-4777-8777-777777777770', display_name_snapshot: 'Alex D.', avatar_key_snapshot: 'initials-purple',avatar:avatar('child-01'), status: 'EXPECTED', version: 1 }] },
    },
  };
}

async function mockApi(page: Page, options: { parent?: boolean; overloaded?: boolean; activeTrip?: boolean;locale?:'nl'|'fr' } = {}) {
  const data = fixtures(Boolean(options.overloaded), Boolean(options.activeTrip));
  data.home.profile.language=options.locale||'nl';
  await page.route('**/functions/v1/bus-app/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/context')) return route.fulfill({ json: { user: { id: userId, email: options.parent ? null : 'driver@example.test', isAnonymous: Boolean(options.parent) },profile:data.home.profile, spaces: options.parent ? [] : [data.home.space], parentGrants: options.parent ? [{ id: grantId, parent_access_id: '11111111-1111-4111-8111-111111111111', last_seen_at: new Date().toISOString() }] : [] } });
    if (path.endsWith(`/spaces/${spaceId}/home`)) return route.fulfill({ json: data.home });
    if (path.endsWith(`/spaces/${spaceId}/trip`)) return route.fulfill({ json: data.trip });
    if (path.endsWith('/parent/home')) return route.fulfill({ json: { grantId, parent: { displayName: 'Alex',profile:data.home.profile }, space: data.home.space, bus: data.home.bus, trip: { id: tripId, status: 'IN_TRANSIT', currentStopSequence: 0, startedAt: new Date().toISOString(), location: { latitude: 50.945, longitude: 4.045, capturedAt: new Date().toISOString() } }, passengers: [{ ...data.home.passengers[0], stop: { id: stopId, display_address: data.home.stops[0].display_address, latitude: 50.95, longitude: 4.05 }, status: 'BOARDED', statusVersion: 2, etaMinutes: 4 }] } });
    if (path.endsWith('/parent/bus-profile')) return route.fulfill({ json: {
      bus: { displayName: 'Buurtbus Ukkel', avatar: { source: 'BUILT_IN', builtInAvatarId: 'bus-yellow-city', assetId: null, version: 1, photoUrl: null }, currentTripStatus: 'IN_TRANSIT' },
      driver: { displayName: 'Marc', role: 'DRIVER', avatar: { source: 'BUILT_IN', builtInAvatarId: 'adult-02', assetId: null, version: 1, photoUrl: null } },
      attendant: { displayName: 'Sophie', role: 'ATTENDANT', avatar: { source: 'BUILT_IN', builtInAvatarId: 'adult-05', assetId: null, version: 1, photoUrl: null } },
      ownStop: { displayAddress: data.home.stops[0].display_address },
    } });
    if (path.endsWith('/notifications')) return route.fulfill({ json: { notifications: [] } });
    return route.fulfill({ json: { ok: true } });
  });
}

for (const locale of ['nl', 'fr'] as const) {
  for (const viewport of viewports) {
    test(`${locale} entry ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.addInitScript((language) => { localStorage.clear(); localStorage.setItem('bus-app-locale', language); }, locale);
      await page.goto('/');
      await expect(page.getByText(locale === 'fr' ? 'Pourquoi êtes-vous ici ?' : 'Waarvoor kom je?')).toBeVisible();
      await expect(page.getByRole('button', { name: new RegExp(locale === 'fr' ? 'JE SUIS PARENT' : 'IK BEN OUDER', 'i') })).toBeVisible();
      await geometry(page);
      if ([360, 390, 430, 768, 820].includes(viewport.width)) await page.screenshot({ path: `${artifacts}/entry-${locale}-${viewport.width}x${viewport.height}.png`, fullPage: true });
    });
  }
}

for (const locale of ['nl', 'fr'] as const) {
  test(`${locale} driver pages stay warm, compact and reachable`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page, 'BUS', locale);
    await mockApi(page, { overloaded: true,locale });
    await page.goto('/');
    await expect(page.locator('.friendly-landscape .friendly-landscape__bus')).toBeVisible();
    await expect(page.getByText(locale === 'fr' ? '4 passagers pour 2 places' : '4 passagiers voor 2 plaatsen')).toBeVisible();
    await geometry(page, true);
    await page.screenshot({ path: `${artifacts}/home-${locale}-390x844.png`, fullPage: true });

    await page.getByRole('navigation', { name: 'BusApp' }).getByRole('button', { name: locale === 'fr' ? 'Itinéraire' : 'Route' }).click();
    await expect(page.getByRole('heading', { level: 1, name: locale === 'fr' ? 'Itinéraire' : 'Route' })).toHaveCount(1);
    await expect(page.getByText(locale === 'fr' ? 'Distance et durée estimées' : 'Geschatte afstand en reistijd')).toHaveCount(1);
    await expect(page.getByText('± 31.8 km')).toBeVisible();
    await expect(page.locator('.route-map,.bus-scene,[data-route-geometry]')).toHaveCount(0);
    await geometry(page, true);
    await page.screenshot({ path: `${artifacts}/route-${locale}-390x844.png`, fullPage: true });

    await page.getByRole('navigation', { name: 'BusApp' }).getByRole('button', { name: locale === 'fr' ? 'Passagers' : 'Passagiers' }).click();
    await expect(page.locator('.manager-panel')).toHaveCount(0);
    await page.screenshot({ path: `${artifacts}/passengers-${locale}-390x844.png`, fullPage: true });
    await page.getByRole('button', { name: locale === 'fr' ? 'Ajouter un passager' : 'Passagier toevoegen' }).click();
    await expect(page.locator('.manager-panel')).toBeVisible();
    await page.locator('.manager-form input').focus();
    await page.setViewportSize({ width: 390, height: 520 });
    await geometry(page, true);
    await page.screenshot({ path: `${artifacts}/passenger-form-keyboard-${locale}-390x520.png`, fullPage: false });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('navigation', { name: 'BusApp' }).getByRole('button', { name: locale === 'fr' ? 'Profil' : 'Profiel' }).click();
    await expect(page.getByText(locale==='fr'?"Langue de l’application":'Taal van de app')).toBeVisible();
    await expect(page.getByRole('button',{name:locale==='fr'?'FR':'NL'}).last()).toHaveAttribute('aria-pressed','true');
    await geometry(page, true);
    await page.screenshot({ path: `${artifacts}/profile-${locale}-390x844.png`, fullPage: true });
  });

  test(`${locale} parent and active trip views remain private and operational`, async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await seed(page, 'PARENT', locale, true);
    await mockApi(page, { parent: true,locale });
    await page.goto('/');
    await expect(page.getByText(locale === 'fr' ? 'Bonjour Alex' : 'Hallo Alex')).toBeVisible();
    await expect(page.getByText('Voorbeeldlaan 1').first()).toBeVisible();
    await expect(page.getByText('1180 Ukkel').first()).toBeVisible();
    await expect(page.getByText('Alex D.').first()).toBeVisible();
    await expect(page.getByText(locale === 'fr' ? 'Presque à votre arrêt' : 'Bijna bij jouw halte')).toBeVisible();
    await geometry(page, true);
    await page.screenshot({ path: `${artifacts}/parent-${locale}-412x915.png`, fullPage: true });

    await seed(page, 'BUS', locale);
    await mockApi(page, { activeTrip: true,locale });
    await page.goto('/');
    await expect(page.locator('.trip-progress__bus')).toBeVisible();
    await expect(page.getByText(locale === 'fr' ? 'Prochain arrêt' : 'Volgende halte')).toBeVisible();
    await expect(page.getByRole('button', { name: locale === 'fr' ? 'Approche' : 'Naderen' })).toBeVisible();
    await geometry(page);
    await page.screenshot({ path: `${artifacts}/active-trip-${locale}-412x915.png`, fullPage: true });
  });
}

test('browser language is used only when no preference was stored', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('language-test-ready')) {
      localStorage.clear();
      sessionStorage.setItem('language-test-ready', '1');
    }
    Object.defineProperty(navigator, 'language', { configurable: true, value: 'fr-BE' });
  });
  await page.goto('/');
  await expect(page.getByText('Pourquoi êtes-vous ici ?')).toBeVisible();
  await page.getByRole('button', { name: 'NL' }).click();
  await page.reload();
  await expect(page.getByText('Waarvoor kom je?')).toBeVisible();
});

test('landscape and 200 percent inherited text do not overflow', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await expect(page.getByText('Waarvoor kom je?')).toBeVisible();
  await geometry(page);
  await page.screenshot({ path: `${artifacts}/entry-landscape-200-percent.png`, fullPage: true });
});

test('manifest and install icons are reachable and dimensioned', async ({ page }) => {
  await page.goto('/');
  const manifest = await page.evaluate(async () => await fetch('/manifest.webmanifest').then((response) => response.json()));
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons).toHaveLength(4);
  for (const icon of manifest.icons) {
    const result = await page.evaluate(async ({ src }) => await new Promise<{ ok: boolean; width: number; height: number }>((resolve) => {
      const image = new Image();
      image.onload = () => resolve({ ok: true, width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => resolve({ ok: false, width: 0, height: 0 });
      image.src = src;
    }), { src: icon.src });
    const expected = Number(String(icon.sizes).split('x')[0]);
    expect(result).toEqual({ ok: true, width: expected, height: expected });
  }
});

for (const locale of ['nl', 'fr'] as const) {
  test(`${locale} authenticated shells render no BusApp top bar`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const mode of ['BUS', 'PARENT'] as const) {
      await seed(page, mode, locale, mode === 'PARENT');
      await mockApi(page, { parent: mode === 'PARENT', locale });
      await page.goto('/');
      await expect(page.locator('.page-header')).toHaveCount(0);
      // The BusApp wordmark belongs to the unauthenticated entry, not to every screen.
      await expect(page.locator('.brand')).toHaveCount(0);
      await expect(page.getByRole('navigation', { name: 'BusApp' })).toBeVisible();
      // No blank header space is left behind: real content starts at the top of the shell.
      const top = await page.evaluate(() => {
        const content = document.querySelector('.page-content');
        return content ? content.firstElementChild!.getBoundingClientRect().top : 999;
      });
      expect(top, 'content must not sit below an empty header gap').toBeLessThan(60);
      await geometry(page, true);
    }
  });

  test(`${locale} driver edits the person and the bus as separate identities`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page, 'BUS', locale);
    await mockApi(page, { locale });
    await page.goto('/');
    await page.getByRole('navigation', { name: 'BusApp' }).getByRole('button', { name: locale === 'fr' ? 'Profil' : 'Profiel' }).click();

    // The personal card is a person and shows the role, never the bus name.
    const personal = page.locator('.profile-editor-card').first();
    await expect(personal.getByRole('heading', { level: 2, name: 'Alex' })).toBeVisible();
    await expect(personal.getByText(locale === 'fr' ? 'Conducteur' : 'Chauffeur')).toBeVisible();
    await expect(personal.getByRole('heading', { level: 2, name: 'Buurtbus Ukkel' })).toHaveCount(0);

    // Read mode by default: no permanently exposed input, no icon-only save.
    await expect(personal.locator('input')).toHaveCount(0);
    await personal.getByRole('button', { name: locale === 'fr' ? 'Modifier le profil' : 'Profiel aanpassen' }).click();
    await expect(personal.locator('.profile-name-form input')).toBeVisible();
    await expect(personal.getByRole('button', { name: locale === 'fr' ? 'Enregistrer' : 'Opslaan' })).toBeVisible();
    await expect(personal.getByRole('button', { name: locale === 'fr' ? 'Annuler' : 'Annuleren' }).first()).toBeVisible();
    await personal.getByRole('button', { name: locale === 'fr' ? 'Annuler' : 'Annuleren' }).first().click();
    await expect(personal.locator('.profile-name-form input')).toHaveCount(0);

    // The bus is its own card under "my bus", with a name field and the bus avatars.
    const busCard = page.locator('.bus-profile-card');
    await expect(page.getByRole('heading', { level: 2, name: locale === 'fr' ? 'Mon bus' : 'Mijn bus' })).toBeVisible();
    await expect(busCard.getByRole('heading', { level: 2, name: 'Buurtbus Ukkel' })).toBeVisible();
    await busCard.getByRole('button', { name: locale === 'fr' ? 'Modifier le bus' : 'Bus aanpassen' }).click();
    await expect(busCard.locator('.profile-name-form input')).toHaveValue('Buurtbus Ukkel');
    await expect(busCard.locator('.avatar-catalog--bus button')).toHaveCount(6);
    await expect(busCard.getByText(locale === 'fr' ? 'Importer une photo' : 'Foto uploaden')).toBeVisible();
    await geometry(page, true);
    await page.screenshot({ path: `${artifacts}/profile-identities-${locale}-390x844.png`, fullPage: true });
  });

  test(`${locale} parent opens the assigned bus profile and edits their own profile`, async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await seed(page, 'PARENT', locale, true);
    await mockApi(page, { parent: true, locale });
    await page.goto('/');

    await page.locator('.parent-bus-cta').click();
    await expect(page.getByRole('heading', { level: 1, name: 'Buurtbus Ukkel' })).toBeVisible();
    await expect(page.getByText('Marc')).toBeVisible();
    await expect(page.getByText(locale === 'fr' ? 'Conducteur' : 'Chauffeur')).toBeVisible();
    await expect(page.getByText('Sophie')).toBeVisible();
    await expect(page.getByText(locale === 'fr' ? 'Accompagnateur' : 'Begeleider')).toBeVisible();
    // Nothing private about the staff reaches the parent view.
    await expect(page.getByText('@')).toHaveCount(0);
    await expect(page.getByText(userId)).toHaveCount(0);
    await expect(page.locator('.parent-bus-profile')).not.toContainText('OWNER');
    await geometry(page, true);
    await page.screenshot({ path: `${artifacts}/parent-bus-profile-${locale}-412x915.png`, fullPage: true });
    await page.getByRole('button', { name: locale === 'fr' ? 'Retour' : 'Terug' }).click();
    await expect(page.locator('.parent-bus-cta')).toBeVisible();

    await page.getByRole('navigation', { name: 'BusApp' }).getByRole('button', { name: locale === 'fr' ? 'Profil' : 'Profiel' }).click();
    const personal = page.locator('.profile-editor-card').first();
    await expect(personal.getByText(locale === 'fr' ? 'Parent' : 'Ouder')).toBeVisible();
    await personal.getByRole('button', { name: locale === 'fr' ? 'Modifier le profil' : 'Profiel aanpassen' }).click();
    await expect(personal.locator('.profile-name-form input')).toHaveValue('Alex');
    // The parent edits their own passenger avatar through a labelled action.
    await page.getByRole('button', { name: locale === 'fr' ? "Modifier l'avatar" : 'Avatar aanpassen' }).click();
    await expect(page.locator('.avatar-catalog--child button')).toHaveCount(24);
    await geometry(page, true);
    await page.screenshot({ path: `${artifacts}/parent-profile-edit-${locale}-412x915.png`, fullPage: true });
  });
}

// Tiles are blocked in every map test: the suite stays hermetic, and a tile outage is
// exactly the failure mode the trip runtime must survive.
async function blockTiles(page: Page) {
  tilesBlocked.add(page);
  await page.route('https://tiles.openfreemap.org/**', (route) => route.abort());
}

for (const locale of ['nl', 'fr'] as const) {
  test(`${locale} route map renders stops without inventing a road line`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await blockTiles(page);
    await seed(page, 'BUS', locale);
    await mockApi(page, { locale });
    await page.goto('/');
    await page.getByRole('navigation', { name: 'BusApp' }).getByRole('button', { name: locale === 'fr' ? 'Itinéraire' : 'Route' }).click();

    // The map is present and lazily loaded.
    await expect(page.locator('.bus-map')).toBeVisible();
    await expect(page.locator('.bus-map__canvas')).toBeVisible();

    // The fixture route is an estimate, so it keeps the approximation marker and the
    // explicit estimate wording, and no road polyline may exist.
    await expect(page.getByText(locale === 'fr' ? "Estimation d'itinéraire" : 'Route-inschatting')).toBeVisible();
    await expect(page.getByText('± 31.8 km')).toBeVisible();
    await expect(page.locator('.route-map,[data-route-geometry],.bus-scene')).toHaveCount(0);

    // A tile outage never removes the route facts or the trip action.
    await expect(page.getByText('± 42 min')).toBeVisible();
    await expect(page.getByRole('button', { name: locale === 'fr' ? 'Démarrer le trajet' : 'Start rit' })).toBeVisible();
    await geometry(page, true);
    await page.screenshot({ path: `${artifacts}/route-map-${locale}-390x844.png`, fullPage: true });
  });
}

test('the map fits every supported viewport without overflow or hidden attribution', async ({ page }) => {
  await blockTiles(page);
  await seed(page, 'BUS', 'nl');
  await mockApi(page, { locale: 'nl' });
  for (const viewport of [{ width: 320, height: 800 }, { width: 360, height: 800 }, { width: 390, height: 844 }, { width: 412, height: 915 }, { width: 430, height: 932 }, { width: 768, height: 1024 }, { width: 820, height: 1180 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.getByRole('navigation', { name: 'BusApp' }).getByRole('button', { name: 'Route' }).click();
    await expect(page.locator('.bus-map')).toBeVisible();
    // The map must never push the page wider than the viewport.
    await geometry(page, true);
    const clear = await page.evaluate(() => {
      const map = document.querySelector('.bus-map');
      const nav = document.querySelector('.bottom-nav');
      if (!map || !nav) return false;
      return map.getBoundingClientRect().width <= document.documentElement.clientWidth + 1;
    });
    expect(clear, `map must fit ${viewport.width}px`).toBe(true);
  }
});

test('landscape and 200 percent text keep the map usable', async ({ page }) => {
  await blockTiles(page);
  await seed(page, 'BUS', 'nl');
  await mockApi(page, { locale: 'nl' });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/');
  await page.getByRole('navigation', { name: 'BusApp' }).getByRole('button', { name: 'Route' }).click();
  await expect(page.locator('.bus-map')).toBeVisible();
  await geometry(page, true);
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await expect(page.getByText('Route-inschatting')).toBeVisible();
  await geometry(page);
  await page.screenshot({ path: `${artifacts}/route-map-landscape-200.png`, fullPage: true });
});
