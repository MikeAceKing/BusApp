import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { readFileSync } from 'node:fs';

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const publicKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!url || !publicKey || !secretKey) throw new Error('Production Supabase environment is incomplete.');

const clientOptions={auth:{persistSession:false,autoRefreshToken:false},realtime:{transport:WebSocket}};
const admin = createClient(url, secretKey, clientOptions);
const email = `busapp-smoke-${crypto.randomUUID()}@example.invalid`;
const password = `Smoke-${crypto.randomUUID()}-9a!`;
let driverId = '';
let parentId = '';
let spaceId = '';

function assert(value, message) {
  if (!value) throw new Error(message);
}

async function request(token, path, options = {}) {
  const response = await fetch(`${url}/functions/v1/bus-app${path}`, {
    method: options.method || 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      apikey: publicKey,
      'content-type': 'application/json',
      ...(options.mutation ? { 'idempotency-key': crypto.randomUUID() } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path}: ${response.status} ${payload.error || ''} ${payload.message || ''}`);
  return payload;
}

async function uploadPhoto(token,path) {
  const form=new FormData();
  const png=readFileSync(new URL('../public/icons/icon-192.png',import.meta.url));
  form.set('file',new Blob([png],{type:'image/png'}),'smoke.png');
  const response=await fetch(`${url}/functions/v1/bus-app-media${path}`,{method:'POST',headers:{authorization:`Bearer ${token}`,apikey:publicKey},body:form});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(`media ${path}: ${response.status} ${payload.error||''} ${payload.message||''}`);
  return payload;
}

try {
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { source: 'busapp-production-smoke' } });
  if (created.error) throw created.error;
  driverId = created.data.user.id;

  const driver = createClient(url, publicKey, clientOptions);
  const signed = await driver.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session) throw signed.error || new Error('Driver sign-in failed.');
  const driverToken = signed.data.session.access_token;

  let context=await request(driverToken,'/context');
  assert(context.profile?.language==='nl'&&context.profile?.avatar?.version===1,'Canonical driver profile is missing.');
  const changedProfile=await request(driverToken,'/profile',{method:'PATCH',body:{language:'fr',expectedVersion:context.profile.avatar.version}});
  assert(changedProfile.profile?.language==='fr','Profile language did not persist.');
  const photo=await uploadPhoto(driverToken,'/profile');
  assert(photo.avatar?.source==='UPLOAD'&&photo.avatar?.photoUrl,'Sanitized profile photo was not stored privately.');
  context=await request(driverToken,'/context');
  assert(context.profile?.avatar?.source==='UPLOAD','Uploaded profile photo is not canonical.');
  await request(driverToken,'/profile',{method:'PATCH',body:{builtInAvatarId:'adult-02',expectedVersion:context.profile.avatar.version}});

  const createdSpace = await request(driverToken, '/spaces', {
    method: 'POST', mutation: true,
    body: {
      name: 'BusApp Production Smoke', avatarKey: 'bus', defaultLanguage: 'nl', capacity: 8,
      start: { displayAddress: 'Stationsplein 1, 9300 Aalst, België', latitude: 50.9427, longitude: 4.0394, provider: 'acceptance', reference: 'start' },
      end: null,
    },
  });
  spaceId = createdSpace.spaceId;
  assert(spaceId, 'Space was not created.');

  await request(driverToken, `/spaces/${spaceId}/stops`, {
    method: 'POST', mutation: true,
    body: {
      location: { displayAddress: 'Grote Markt 1, 9300 Aalst, België', latitude: 50.9383, longitude: 4.0392, provider: 'acceptance', reference: 'stop' },
      label: 'Smoke stop', expectedPassengerCount: 1, passengerNames: ['Smoke Passenger'],
    },
  });
  let home = await request(driverToken, `/spaces/${spaceId}/home`);
  const passengerId = home.passengers?.[0]?.id;
  assert(passengerId && home.stops?.length === 1, 'Stop/passenger snapshot is incomplete.');
  const staffAvatar=await request(driverToken,`/spaces/${spaceId}/passengers/${passengerId}/avatar`,{method:'PATCH',body:{builtInAvatarId:'child-07',expectedVersion:home.passengers[0].avatar.version}});
  assert(staffAvatar.passenger?.avatar?.builtInAvatarId==='child-07','Staff passenger avatar did not update.');

  const access = await request(driverToken, `/spaces/${spaceId}/parent-access`, {
    method: 'POST', mutation: true,
    body: { parentDisplayName: 'Smoke Parent', passengerIds: [passengerId] },
  });
  assert(access.code && !JSON.stringify(home).includes(access.code), 'Parent code handling is invalid.');

  const route = await request(driverToken, `/spaces/${spaceId}/routes/optimize`, {
    method: 'POST', mutation: true,
    body: { mode: 'AUTOMATIC', roundTrip: false },
  });
  assert(route.routePlan?.stops?.length === 1, 'Route snapshot is incomplete.');
  const started = await request(driverToken, `/spaces/${spaceId}/trips/start`, {
    method: 'POST', mutation: true,
    body: { routePlanId: route.routePlan.id },
  });

  const parent = createClient(url, publicKey, clientOptions);
  const anonymous = await parent.auth.signInAnonymously({ options: { data: { source: 'busapp-production-smoke' } } });
  if (anonymous.error || !anonymous.data.session) throw anonymous.error || new Error('Anonymous parent sign-in failed.');
  parentId = anonymous.data.user?.id || '';
  const parentToken = anonymous.data.session.access_token;
  const activated = await request(parentToken, '/parent/activate', { method: 'POST', mutation: true, body: { code: access.code } });
  assert(activated.grantId, 'Parent grant was not created.');
  let parentSnapshot=await request(parentToken,`/parent/home?grantId=${activated.grantId}`);
  const parentAvatar=await request(parentToken,`/parent/passengers/${passengerId}/avatar`,{method:'PATCH',body:{builtInAvatarId:'child-08',expectedVersion:parentSnapshot.passengers[0].avatar.version}});
  assert(parentAvatar.passenger?.avatar?.builtInAvatarId==='child-08','Parent passenger avatar did not update.');
  const passengerPhoto=await uploadPhoto(parentToken,`/parent/passengers/${passengerId}`);
  assert(passengerPhoto.avatar?.source==='UPLOAD','Parent passenger photo upload failed.');
  home=await request(driverToken,`/spaces/${spaceId}/home`);
  assert(home.passengers[0].avatar.source==='UPLOAD','Canonical passenger photo did not synchronize to staff.');

  await request(driverToken, `/trips/${started.tripId}/transition`, { method: 'POST', body: { transition: 'START' } });
  try {
    await request(driverToken, `/trips/${started.tripId}/location`, {
      method: 'POST', mutation: true,
      body: { driverSessionId: started.driverSessionId, latitude: 50.9427, longitude: 4.0394, accuracyMeters: 8, speedMps: 5, capturedAt: new Date().toISOString() },
    });
  } catch (error) {
    const [live, history, pulses, notifications] = await Promise.all([
      admin.from('bus_app_trip_live_locations').select('trip_id').eq('trip_id', started.tripId),
      admin.from('bus_app_trip_location_events').select('id').eq('trip_id', started.tripId),
      admin.from('bus_app_parent_trip_updates').select('id').eq('trip_id', started.tripId),
      admin.from('bus_app_notifications').select('id').eq('trip_id', started.tripId),
    ]);
    console.error(JSON.stringify({ locationCheckpoint: { live: live.data?.length || 0, history: history.data?.length || 0, pulses: pulses.data?.length || 0, notifications: notifications.data?.length || 0 } }));
    throw error;
  }
  const runtime = await request(driverToken, `/spaces/${spaceId}/trip`);
  const status = runtime.trip?.passengers?.[0];
  assert(status?.passenger_id === passengerId, 'Trip passenger snapshot is incomplete.');
  await request(driverToken, `/trips/${started.tripId}/attendance`, {
    method: 'POST', mutation: true,
    body: { passengerId, status: 'BOARDED', expectedVersion: status.version },
  });

  const parentHome = await request(parentToken, `/parent/home?grantId=${activated.grantId}`);
  assert(parentHome.passengers?.length === 1, 'Parent received an invalid passenger set.');
  assert(parentHome.passengers[0].id === passengerId, 'Parent received another passenger.');
  assert(parentHome.passengers[0].status === 'BOARDED', 'Parent attendance did not update.');
  assert(parentHome.trip?.location && Object.keys(parentHome.trip.location).every((key) => ['latitude', 'longitude', 'capturedAt'].includes(key)), 'Parent location payload is not filtered.');
  assert(!('stops' in (parentHome.trip || {})) && !('members' in parentHome), 'Parent received private route/member data.');

  const parentBus = await request(parentToken, `/parent/bus-profile?grantId=${activated.grantId}`);
  assert(parentBus.bus?.displayName, 'Parent did not receive the assigned bus identity.');
  assert(parentBus.bus.avatar && typeof parentBus.bus.avatar.source === 'string', 'Parent bus avatar reference is missing.');
  assert(parentBus.driver?.role === 'DRIVER' && parentBus.driver.displayName, 'Parent did not receive the assigned driver.');
  assert(Object.keys(parentBus.driver).every((key) => ['displayName', 'role', 'avatar'].includes(key)), 'Parent staff payload exposes more than name, role and avatar.');
  assert(!('id' in parentBus.bus) && !('busSpaceId' in parentBus) && !('members' in parentBus), 'Parent bus payload leaks internal identifiers.');
  const parentBusText = JSON.stringify(parentBus);
  assert(!parentBusText.includes('@'), 'Parent bus payload contains an address-like contact value.');
  assert(!parentBusText.includes(driverId), 'Parent bus payload leaks a staff user id.');

  home = await request(driverToken, `/spaces/${spaceId}/home`);
  assert(home.activeTrip?.id === started.tripId, 'Active trip is not visible to staff.');
  assert(home.permissions?.manageBusProfile === true, 'Bus profile permission was not resolved for the owner.');
  console.log(JSON.stringify({ ok: true, profileLanguage: true,privateProfilePhoto:true,space: true, stop: true, passenger: true,syncedPassengerPhoto:true, route: true, trip: true, anonymousParent: true, filteredParentPayload: true, parentBusProfile: true, busProfilePermission: true }));
} finally {
  if (spaceId) await admin.from('bus_app_spaces').delete().eq('id', spaceId);
  if (parentId) await admin.auth.admin.deleteUser(parentId);
  if (driverId) await admin.auth.admin.deleteUser(driverId);
}
