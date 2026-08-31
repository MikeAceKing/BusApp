import { Hono } from 'npm:hono@4.5.10';
import { createClient, type SupabaseClient, type User } from 'jsr:@supabase/supabase-js@2';
import { corsPreflight, withCors } from '../_shared/cors.ts';
import { notifyBusAppEvent, webPushPublicKey } from './notifications.ts';
import { configuredProvider, geocodeAddress, optimizeRoute, RoutingError, type Point } from './routing.ts';
import {
  activateParentSchema, attendanceSchema, createSpaceSchema, createStopSchema,
  busProfileSchema,
  idempotencyKeySchema, locationSchema, optimizeRouteSchema, parentAccessSchema,
  passengerAvatarSchema, passengerSchema, profileUpdateSchema, pushSubscriptionSchema, stopActionSchema, transitionSchema,
  updateStopSchema, type BusSpaceRole,
} from './schemas.ts';

type Row = Record<string, unknown>;
type Access = { user: User; spaceId: string; role: BusSpaceRole; permissions: Row };
type MutationResult = { status: number; body: Row };

const app = new Hono().basePath('/bus-app');
const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const codeSecret = Deno.env.get('BUS_APP_CODE_HASH_SECRET') || Deno.env.get('SCHOOL_BUS_INVITE_HASH_SECRET') || '';
const clientOptions = { auth:{ persistSession:false, autoRefreshToken:false, detectSessionInUrl:false } } as const;
const authClient = createClient(supabaseUrl, anonKey, clientOptions);
const db = createClient(supabaseUrl, serviceKey, clientOptions);

if (!supabaseUrl || !anonKey || !serviceKey) console.error('[bus-app] Supabase environment is incomplete');

app.use('*', async (c,next) => { if (c.req.method === 'OPTIONS') return corsPreflight(c.req.raw); await next(); c.res = withCors(c.req.raw,c.res); });

class HttpError extends Error { constructor(readonly status:number, readonly code:string, message:string) { super(message); } }
function rows(value:unknown): Row[] { return Array.isArray(value) ? value.filter((item):item is Row => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : []; }
function text(value:unknown):string { return typeof value === 'string' ? value : ''; }
function numberValue(value:unknown,fallback=0):number { const parsed=Number(value); return Number.isFinite(parsed)?parsed:fallback; }
function bool(value:unknown):boolean { return value === true; }
function normalizeAddress(value:string):string { return value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('nl-BE').replace(/[^a-z0-9]+/g,' ').trim(); }
function distanceMeters(aLat:number,aLon:number,bLat:number,bLon:number):number { const radians=(value:number)=>value*Math.PI/180;const dLat=radians(bLat-aLat);const dLon=radians(bLon-aLon);const value=Math.sin(dLat/2)**2+Math.cos(radians(aLat))*Math.cos(radians(bLat))*Math.sin(dLon/2)**2;return 6_371_000*2*Math.atan2(Math.sqrt(value),Math.sqrt(1-value)); }

async function authenticate(request:Request):Promise<User> {
  const authorization=String(request.headers.get('authorization')||'').trim();
  if (!authorization.startsWith('Bearer ')) throw new HttpError(401,'AUTH_REQUIRED','Connexion requise.');
  const result=await authClient.auth.getUser(authorization.slice(7).trim());
  if (result.error || !result.data.user) throw new HttpError(401,'AUTH_INVALID','La session a expiré.');
  return result.data.user;
}

async function sha256(value:string):Promise<string> { const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)); return [...new Uint8Array(digest)].map((byte)=>byte.toString(16).padStart(2,'0')).join(''); }
async function hmac(value:string):Promise<string> {
  if (codeSecret.length<32) throw new HttpError(503,'CODE_SERVICE_UNAVAILABLE','Buscode is tijdelijk niet beschikbaar.');
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(codeSecret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map((byte)=>byte.toString(16).padStart(2,'0')).join('');
}

function normalizedCode(value:string):string { return value.toUpperCase().replace(/[^A-Z0-9]/g,''); }
function newCode():string { const alphabet='23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; const bytes=crypto.getRandomValues(new Uint8Array(12)); const raw=[...bytes].map((value)=>alphabet[value%alphabet.length]).join(''); return `${raw.slice(0,4)}-${raw.slice(4,8)}-${raw.slice(8)}`; }
function ipAddress(request:Request):string { return String(request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown').trim().slice(0,100); }

async function accessForSpace(request:Request,spaceId:string,allowed:readonly BusSpaceRole[]=['OWNER','DRIVER','ATTENDANT']):Promise<Access> {
  const user=await authenticate(request);
  const membership=await db.from('bus_app_members').select('role,permissions').eq('bus_space_id',spaceId).eq('user_id',user.id).eq('active',true).in('role',[...allowed]).order('role').limit(1).maybeSingle();
  if (membership.error) throw membership.error;
  if (!membership.data) throw new HttpError(403,'BUS_SPACE_ACCESS_REQUIRED','Geen toegang tot deze bus.');
  return { user,spaceId,role:text(membership.data.role) as BusSpaceRole,permissions:(membership.data.permissions||{}) as Row };
}

// Bus Space permissions are resolved on the server. A member record may carry an
// explicit grant or denial; otherwise the stored role maps to the Bus Space default.
// A client-supplied role is never consulted.
const busSpacePermissionDefaults:Record<string,Record<BusSpaceRole,boolean>>={
  MANAGE_BUS_PROFILE:{OWNER:true,DRIVER:true,ATTENDANT:true},
  MANAGE_ROUTE:{OWNER:true,DRIVER:true,ATTENDANT:false},
};
function hasBusSpacePermission(access:Access,permission:keyof typeof busSpacePermissionDefaults):boolean{
  const explicit=access.permissions[permission];
  if(typeof explicit==='boolean')return explicit;
  return busSpacePermissionDefaults[permission][access.role]===true;
}

async function tripAccess(request:Request,tripId:string,allowed:readonly BusSpaceRole[]):Promise<{access:Access;trip:Row}> {
  const trip=await db.from('bus_app_trips').select('*').eq('id',tripId).maybeSingle();
  if (trip.error) throw trip.error; if (!trip.data) throw new HttpError(404,'TRIP_NOT_FOUND','Rit niet gevonden.');
  return { access:await accessForSpace(request,text(trip.data.bus_space_id),allowed),trip:trip.data as Row };
}

async function audit(access:Access,eventType:string,details:Row={}):Promise<void> {
  const result=await db.from('bus_app_audit_events').insert({ bus_space_id:access.spaceId,trip_id:details.tripId||null,passenger_id:details.passengerId||null,parent_access_id:details.parentAccessId||null,actor_user_id:access.user.id,actor_role:access.role,event_type:eventType,metadata:details.metadata||{} });
  if (result.error) throw result.error;
}

function idempotencyKey(request:Request):string { const parsed=idempotencyKeySchema.safeParse(request.headers.get('idempotency-key')); if(!parsed.success) throw new HttpError(400,'IDEMPOTENCY_KEY_REQUIRED','Een geldige actiecode is verplicht.'); return parsed.data; }
async function mutateOnce(request:Request,user:User,operation:string,payload:unknown,execute:()=>Promise<MutationResult>):Promise<MutationResult> {
  const key=idempotencyKey(request); const requestHash=await sha256(JSON.stringify(payload));
  const existing=await db.from('bus_app_idempotency_keys').select('request_hash,response_status,response_body').eq('user_id',user.id).eq('operation',operation).eq('idempotency_key',key).maybeSingle();
  if(existing.error) throw existing.error;
  if(existing.data){ if(text(existing.data.request_hash)!==requestHash) throw new HttpError(409,'IDEMPOTENCY_KEY_REUSED','Deze actiecode is al gebruikt.'); if(existing.data.response_body) return {status:numberValue(existing.data.response_status,200),body:existing.data.response_body as Row}; throw new HttpError(409,'REQUEST_IN_PROGRESS','Deze actie wordt verwerkt.'); }
  const claimed=await db.from('bus_app_idempotency_keys').insert({user_id:user.id,operation,idempotency_key:key,request_hash:requestHash});
  if(claimed.error) throw claimed.error;
  try { const result=await execute(); await db.from('bus_app_idempotency_keys').update({response_status:result.status,response_body:result.body,completed_at:new Date().toISOString()}).eq('user_id',user.id).eq('operation',operation).eq('idempotency_key',key); return result; }
  catch(error){ await db.from('bus_app_idempotency_keys').delete().eq('user_id',user.id).eq('operation',operation).eq('idempotency_key',key); throw error; }
}

// Meters BusApp's own use of the shared free provider quota. Returns a recorder so the
// call's outcome and latency can be attached once the provider has answered.
async function consumeRoutingQuota(userId:string,operation:'geocode'|'route.optimize'|'route.recalculate',perHour:number):Promise<(outcome:'ROAD'|'ESTIMATE'|'FAILED',provider:string,startedAt:number)=>Promise<void>>{
  const since=new Date(Date.now()-60*60*1000).toISOString();
  const used=await db.from('bus_app_routing_usage').select('id',{count:'exact',head:true}).eq('user_id',userId).eq('operation',operation).gte('created_at',since);
  if(used.error)throw used.error;
  if((used.count||0)>=perHour)throw new HttpError(429,'ROUTING_RATE_LIMITED','Te veel routeaanvragen. Probeer het straks opnieuw.');
  const claimed=await db.from('bus_app_routing_usage').insert({user_id:userId,operation}).select('id').single();
  if(claimed.error)throw claimed.error;
  return async(outcome,provider,startedAt)=>{
    const update=await db.from('bus_app_routing_usage').update({outcome,provider,latency_ms:Math.max(0,Date.now()-startedAt)}).eq('id',claimed.data.id);
    if(update.error)console.error('[bus-app] routing usage update failed',update.error);
  };
}

async function ensureProfile(user:User):Promise<Row> {
  const current=await db.from('bus_app_profiles').select('*').eq('user_id',user.id).maybeSingle();
  if(current.error)throw current.error;if(current.data)return current.data as Row;
  const metadata=user.user_metadata&&typeof user.user_metadata==='object'?user.user_metadata as Row:{};
  const fallback=text(metadata.display_name).trim()||text(metadata.name).trim()||String(user.email||'').split('@')[0]||'BusApp';
  const created=await db.from('bus_app_profiles').insert({user_id:user.id,display_name:fallback.slice(0,50),language:text(metadata.language)==='fr'?'fr':'nl',updated_by:user.id}).select('*').single();
  if(created.error)throw created.error;return created.data as Row;
}

async function avatarReference(item:Row):Promise<Row> {
  const source=text(item.avatar_source)==='UPLOAD'?'UPLOAD':'BUILT_IN';
  const assetId=text(item.avatar_asset_id)||null;
  let photoUrl:string|null=null;
  if(source==='UPLOAD'&&assetId){
    const asset=await db.from('bus_app_avatar_assets').select('thumbnail_storage_path').eq('id',assetId).eq('status','ACTIVE').maybeSingle();
    if(!asset.error&&asset.data){const signed=await db.storage.from('bus-app-private-media').createSignedUrl(text(asset.data.thumbnail_storage_path),300);if(!signed.error)photoUrl=signed.data.signedUrl;}
  }
  return {source:photoUrl?'UPLOAD':'BUILT_IN',builtInAvatarId:text(item.avatar_builtin_id)||null,assetId:photoUrl?assetId:null,version:numberValue(item.avatar_version,1),photoUrl};
}

async function withAvatar<T extends Row>(item:T|null):Promise<(T&{avatar:Row})|null> {
  return item?{...item,avatar:await avatarReference(item)}:null;
}

async function withAvatars(items:Row[]):Promise<Row[]> { return await Promise.all(items.map(async(item)=>({...item,avatar:await avatarReference(item)}))); }

async function avatarRecipients(spaceId:string,kind:'PASSENGER'|'BUS',entityId:string):Promise<string[]> {
  const members=await db.from('bus_app_members').select('user_id').eq('bus_space_id',spaceId).eq('active',true);if(members.error)throw members.error;
  const recipients=rows(members.data).map((item)=>text(item.user_id));
  if(kind==='PASSENGER')recipients.push(...(await parentRecipientsForPassengers([entityId])).userIds);
  else {const access=await db.from('bus_app_parent_access').select('id').eq('bus_space_id',spaceId).is('revoked_at',null);if(access.error)throw access.error;const ids=rows(access.data).map((item)=>text(item.id));const grants=ids.length?await db.from('bus_app_parent_grants').select('user_id').in('parent_access_id',ids).is('revoked_at',null):{data:[],error:null};if(grants.error)throw grants.error;recipients.push(...rows(grants.data).map((item)=>text(item.user_id)));}
  return [...new Set(recipients.filter(Boolean))];
}

async function emitAvatarPulse(userIds:string[],spaceId:string|null,eventType:'PROFILE_AVATAR_UPDATED'|'PASSENGER_AVATAR_UPDATED'|'BUS_AVATAR_UPDATED',entityId:string):Promise<void>{
  if(!userIds.length)return;const result=await db.from('bus_app_avatar_updates').insert(userIds.map((userId)=>({user_id:userId,bus_space_id:spaceId,event_type:eventType,entity_id:entityId})));if(result.error)throw result.error;
}

async function retireAvatarAsset(assetId:string|null):Promise<void>{
  if(!assetId)return;const old=await db.from('bus_app_avatar_assets').select('storage_path,thumbnail_storage_path').eq('id',assetId).maybeSingle();
  await db.from('bus_app_avatar_assets').update({status:'REPLACED',replaced_at:new Date().toISOString()}).eq('id',assetId).eq('status','ACTIVE');
  if(old.data)await db.storage.from('bus-app-private-media').remove([text(old.data.storage_path),text(old.data.thumbnail_storage_path)].filter(Boolean));
}

async function contextForUser(user:User):Promise<Row> {
  const [memberships,grants,profile]=await Promise.all([
    db.from('bus_app_members').select('bus_space_id,role,permissions').eq('user_id',user.id).eq('active',true),
    db.from('bus_app_parent_grants').select('id,parent_access_id,last_seen_at').eq('user_id',user.id).is('revoked_at',null),
    ensureProfile(user),
  ]);
  if(memberships.error) throw memberships.error; if(grants.error) throw grants.error;
  const spaceIds=[...new Set(rows(memberships.data).map((item)=>text(item.bus_space_id)).filter(Boolean))];
  const spaces=spaceIds.length ? await db.from('bus_app_spaces').select('id,name,avatar_key,default_language,status').in('id',spaceIds).eq('status','ACTIVE') : {data:[],error:null};
  if(spaces.error) throw spaces.error;
  return { user:{id:user.id,email:user.email||null,isAnonymous:bool(user.is_anonymous)},profile:{...profile,avatar:await avatarReference(profile)}, spaces:rows(spaces.data).map((space)=>({...space,roles:rows(memberships.data).filter((member)=>member.bus_space_id===space.id).map((member)=>member.role)})), parentGrants:rows(grants.data) };
}

async function loadSpaceHome(spaceId:string,user:User):Promise<Row> {
  const [space,buses,members]=await Promise.all([
    db.from('bus_app_spaces').select('id,name,avatar_key,default_language,status').eq('id',spaceId).single(),
    db.from('bus_app_buses').select('*').eq('bus_space_id',spaceId).eq('active',true).order('created_at').limit(1),
    db.from('bus_app_members').select('id,user_id,role,permissions').eq('bus_space_id',spaceId).eq('active',true),
  ]);
  if(space.error) throw space.error; if(buses.error) throw buses.error; if(members.error) throw members.error;
  const profile=await ensureProfile(user);const bus=rows(buses.data)[0]||null; if(!bus) return {space:space.data,profile:{...profile,avatar:await avatarReference(profile)},bus:null,stops:[],passengers:[],routePlan:null,activeTrip:null,members:rows(members.data),parentAccess:[]};
  const [stops,passengers,plans,trips,parentAccess]=await Promise.all([
    db.from('bus_app_stops').select('*').eq('bus_id',bus.id).eq('active',true).order('manual_sequence'),
    db.from('bus_app_passengers').select('*').eq('bus_space_id',spaceId).eq('active',true).order('created_at'),
    db.from('bus_app_route_plans').select('*').eq('bus_id',bus.id).is('stale_at',null).not('selected_at','is',null).order('created_at',{ascending:false}).limit(1),
    db.from('bus_app_trips').select('*').eq('bus_id',bus.id).in('status',['BOARDING','IN_TRANSIT','ARRIVED']).order('created_at',{ascending:false}).limit(1),
    db.from('bus_app_parent_access').select('id,parent_display_name,code_version,created_at,last_used_at,revoked_at').eq('bus_space_id',spaceId).order('created_at',{ascending:false}),
  ]);
  for(const result of [stops,passengers,plans,trips,parentAccess]) if(result.error) throw result.error;
  const plan=rows(plans.data)[0]||null; let planStops:Row[]=[];
  if(plan){ const result=await db.from('bus_app_route_plan_stops').select('*').eq('route_plan_id',plan.id).order('sequence'); if(result.error) throw result.error; planStops=rows(result.data); }
  const accessIds=rows(parentAccess.data).map((item)=>text(item.id)); const links=accessIds.length ? await db.from('bus_app_parent_access_passengers').select('parent_access_id,passenger_id').in('parent_access_id',accessIds) : {data:[],error:null}; if(links.error) throw links.error;
  return {space:space.data,profile:{...profile,avatar:await avatarReference(profile)},bus:await withAvatar(bus),stops:rows(stops.data),passengers:await withAvatars(rows(passengers.data)),routePlan:plan?{...plan,stops:planStops}:null,activeTrip:rows(trips.data)[0]||null,members:rows(members.data),parentAccess:rows(parentAccess.data).map((access)=>({...access,passengerIds:rows(links.data).filter((link)=>link.parent_access_id===access.id).map((link)=>link.passenger_id)}))};
}

async function parentRecipientsForPassengers(passengerIds:string[]):Promise<{userIds:string[];parentAccessIds:string[];targets:Array<{userId:string;parentAccessId:string}>}> {
  if(!passengerIds.length) return {userIds:[],parentAccessIds:[],targets:[]};
  const links=await db.from('bus_app_parent_access_passengers').select('parent_access_id').in('passenger_id',passengerIds); if(links.error) throw links.error;
  const accessIds=[...new Set(rows(links.data).map((item)=>text(item.parent_access_id)).filter(Boolean))]; if(!accessIds.length) return {userIds:[],parentAccessIds:[],targets:[]};
  const access=await db.from('bus_app_parent_access').select('id').in('id',accessIds).is('revoked_at',null); if(access.error) throw access.error;
  const activeIds=rows(access.data).map((item)=>text(item.id)); const grants=activeIds.length?await db.from('bus_app_parent_grants').select('user_id,parent_access_id').in('parent_access_id',activeIds).is('revoked_at',null):{data:[],error:null}; if(grants.error) throw grants.error;
  const targets=rows(grants.data).map((item)=>({userId:text(item.user_id),parentAccessId:text(item.parent_access_id)})).filter((item)=>item.userId&&item.parentAccessId);
  return {userIds:[...new Set(targets.map((item)=>item.userId))],parentAccessIds:activeIds,targets};
}

app.get('/health',(c)=>c.json({ok:true,service:'bus-app',authority:'BUS_SPACE',legacyRollback:'school-bus',privacy:'BUS_NOT_PEOPLE',routingProvider:String(Deno.env.get('ROUTING_PROVIDER')||'local')}));
app.get('/public-config',(c)=>c.json({webPushPublicKey:webPushPublicKey()}));

app.get('/context',async(c)=>{try{return c.json(await contextForUser(await authenticate(c.req.raw)));}catch(error){return handleError(c,error);}});

app.patch('/profile',async(c)=>{try{
  const user=await authenticate(c.req.raw);const parsed=profileUpdateSchema.safeParse(await c.req.json().catch(()=>null));if(!parsed.success)throw new HttpError(400,'INPUT_INVALID','Controleer je profiel.');
  const current=await ensureProfile(user);const patch:Row={updated_at:new Date().toISOString(),updated_by:user.id,avatar_version:parsed.data.expectedVersion+1};
  if(parsed.data.displayName!==undefined)patch.display_name=parsed.data.displayName;if(parsed.data.language!==undefined)patch.language=parsed.data.language;
  if(parsed.data.builtInAvatarId!==undefined)Object.assign(patch,{avatar_source:'BUILT_IN',avatar_builtin_id:parsed.data.builtInAvatarId,avatar_asset_id:null});
  const updated=await db.from('bus_app_profiles').update(patch).eq('user_id',user.id).eq('avatar_version',parsed.data.expectedVersion).select('*').maybeSingle();if(updated.error)throw updated.error;if(!updated.data)throw new HttpError(409,'PROFILE_CONFLICT','Je profiel is intussen gewijzigd. Vernieuw de pagina.');
  if(parsed.data.builtInAvatarId!==undefined)await retireAvatarAsset(text(current.avatar_asset_id)||null);
  await emitAvatarPulse([user.id],null,'PROFILE_AVATAR_UPDATED',user.id);
  await db.from('bus_app_audit_events').insert({actor_user_id:user.id,actor_role:'PROFILE',event_type:'PROFILE_UPDATED',metadata:{languageChanged:parsed.data.language!==undefined,avatarChanged:parsed.data.builtInAvatarId!==undefined}});
  return c.json({profile:{...updated.data,avatar:await avatarReference(updated.data as Row)}});
}catch(error){return handleError(c,error);}});

app.get('/geocode',async(c)=>{try{const user=await authenticate(c.req.raw);if(user.is_anonymous)throw new HttpError(403,'GEOCODING_FORBIDDEN','Adreszoeken is niet beschikbaar voor deze toegang.');const recordGeocode=await consumeRoutingQuota(user.id,'geocode',60);const startedAt=Date.now();const locale=c.req.query('locale')==='fr'?'fr':'nl';try{const results=await geocodeAddress(db,c.req.query('q')||'',locale);await recordGeocode('ROAD',String(Deno.env.get('GEOCODING_PROVIDER')||'nominatim'),startedAt);return c.json({results});}catch(reason){await recordGeocode('FAILED',String(Deno.env.get('GEOCODING_PROVIDER')||'nominatim'),startedAt);throw reason;}}catch(error){return handleError(c,error);}});

app.post('/spaces',async(c)=>{try{
  const user=await authenticate(c.req.raw); if(user.is_anonymous) throw new HttpError(403,'PERMANENT_ACCOUNT_REQUIRED','Maak een gratis chauffeuraccount aan.');
  const parsed=createSpaceSchema.safeParse(await c.req.json().catch(()=>null)); if(!parsed.success) throw new HttpError(400,'INPUT_INVALID','Controleer de busgegevens.');
  const result=await mutateOnce(c.req.raw,user,'space.create',parsed.data,async()=>{
    const created=await db.from('bus_app_spaces').insert({owner_user_id:user.id,name:parsed.data.name,avatar_key:parsed.data.avatarKey,default_language:parsed.data.defaultLanguage}).select('id').single(); if(created.error) throw created.error;
    const spaceId=text(created.data.id);
    try {
      const member=await db.from('bus_app_members').insert({bus_space_id:spaceId,user_id:user.id,role:'OWNER',permissions:{MANAGE_BUS_PROFILE:true}}); if(member.error) throw member.error;
      const bus=await db.from('bus_app_buses').insert({bus_space_id:spaceId,name:parsed.data.name,avatar_key:parsed.data.avatarKey,capacity:parsed.data.capacity,start_display_address:parsed.data.start.displayAddress,start_latitude:parsed.data.start.latitude,start_longitude:parsed.data.start.longitude,end_display_address:parsed.data.end?.displayAddress||null,end_latitude:parsed.data.end?.latitude||null,end_longitude:parsed.data.end?.longitude||null,geocoding_provider:parsed.data.start.provider,geocoding_reference:parsed.data.start.reference||null}).select('*').single(); if(bus.error) throw bus.error;
      return {status:201,body:{spaceId,bus:bus.data}};
    } catch(error) { await db.from('bus_app_spaces').delete().eq('id',spaceId); throw error; }
  }); return c.json(result.body,result.status as 201);
}catch(error){return handleError(c,error);}});

app.get('/spaces/:spaceId/home',async(c)=>{try{const access=await accessForSpace(c.req.raw,c.req.param('spaceId'));return c.json({...await loadSpaceHome(c.req.param('spaceId'),access.user),role:access.role,permissions:{manageBusProfile:hasBusSpacePermission(access,'MANAGE_BUS_PROFILE')}});}catch(error){return handleError(c,error);}});

app.post('/spaces/:spaceId/stops',async(c)=>{try{
  const access=await accessForSpace(c.req.raw,c.req.param('spaceId'),['OWNER','ATTENDANT']); const parsed=createStopSchema.safeParse(await c.req.json().catch(()=>null)); if(!parsed.success) throw new HttpError(400,'INPUT_INVALID','Controleer het adres en aantal passagiers.');
  const result=await mutateOnce(c.req.raw,access.user,'stop.create',parsed.data,async()=>{
    const bus=await db.from('bus_app_buses').select('id').eq('bus_space_id',access.spaceId).eq('active',true).limit(1).single(); if(bus.error) throw bus.error;
    const sequence=await db.from('bus_app_stops').select('manual_sequence').eq('bus_id',bus.data.id).eq('active',true).order('manual_sequence',{ascending:false}).limit(1).maybeSingle(); if(sequence.error) throw sequence.error;
    const stop=await db.from('bus_app_stops').insert({bus_space_id:access.spaceId,bus_id:bus.data.id,label:parsed.data.label||null,display_address:parsed.data.location.displayAddress,normalized_address:normalizeAddress(parsed.data.location.displayAddress),latitude:parsed.data.location.latitude,longitude:parsed.data.location.longitude,geocoding_provider:parsed.data.location.provider,geocoding_reference:parsed.data.location.reference||null,expected_passenger_count:parsed.data.expectedPassengerCount,manual_sequence:numberValue(sequence.data?.manual_sequence)+1}).select('*').single();
    if(stop.error){if(stop.error.code==='23505') throw new HttpError(409,'STOP_DUPLICATE','Dit adres bestaat al in je route.');throw stop.error;}
    if(parsed.data.passengerNames.length){const avatarStyles=['initials-blue','initials-green','initials-purple','initials-orange','initials-rose'];const passengers=await db.from('bus_app_passengers').insert(parsed.data.passengerNames.map((displayName,index)=>({bus_space_id:access.spaceId,stop_id:stop.data.id,display_name:displayName,avatar_key:avatarStyles[index%avatarStyles.length],avatar_builtin_id:`child-${String(index%24+1).padStart(2,'0')}`})));if(passengers.error)throw passengers.error;}
    await audit(access,'STOP_CREATED',{metadata:{stopId:stop.data.id}}); return {status:201,body:{stop:stop.data}};
  }); return c.json(result.body,result.status as 201);
}catch(error){return handleError(c,error);}});

app.patch('/spaces/:spaceId/stops/:stopId',async(c)=>{try{
  const access=await accessForSpace(c.req.raw,c.req.param('spaceId'),['OWNER','ATTENDANT']); const parsed=updateStopSchema.safeParse(await c.req.json().catch(()=>null)); if(!parsed.success) throw new HttpError(400,'INPUT_INVALID','Controleer de halte.');
  const patch:Row={}; if(parsed.data.label!==undefined)patch.label=parsed.data.label;if(parsed.data.expectedPassengerCount!==undefined)patch.expected_passenger_count=parsed.data.expectedPassengerCount;if(parsed.data.location){Object.assign(patch,{display_address:parsed.data.location.displayAddress,normalized_address:normalizeAddress(parsed.data.location.displayAddress),latitude:parsed.data.location.latitude,longitude:parsed.data.location.longitude,geocoding_provider:parsed.data.location.provider,geocoding_reference:parsed.data.location.reference||null});}
  const updated=await db.from('bus_app_stops').update(patch).eq('id',c.req.param('stopId')).eq('bus_space_id',access.spaceId).eq('active',true).select('*').maybeSingle(); if(updated.error)throw updated.error;if(!updated.data)throw new HttpError(404,'STOP_NOT_FOUND','Halte niet gevonden.');await audit(access,'STOP_UPDATED',{metadata:{stopId:c.req.param('stopId')}});return c.json({stop:updated.data,routeStale:true});
}catch(error){return handleError(c,error);}});

app.post('/spaces/:spaceId/passengers',async(c)=>{try{const access=await accessForSpace(c.req.raw,c.req.param('spaceId'),['OWNER','ATTENDANT']);const parsed=passengerSchema.safeParse(await c.req.json().catch(()=>null));if(!parsed.success)throw new HttpError(400,'INPUT_INVALID','Controleer de passagier.');const stop=await db.from('bus_app_stops').select('id').eq('id',parsed.data.stopId).eq('bus_space_id',access.spaceId).eq('active',true).maybeSingle();if(stop.error)throw stop.error;if(!stop.data)throw new HttpError(404,'STOP_NOT_FOUND','Halte niet gevonden.');const created=await db.from('bus_app_passengers').insert({bus_space_id:access.spaceId,stop_id:parsed.data.stopId,display_name:parsed.data.displayName,avatar_key:parsed.data.avatarKey,avatar_builtin_id:parsed.data.builtInAvatarId||null}).select('*').single();if(created.error)throw created.error;await audit(access,'PASSENGER_CREATED',{passengerId:text(created.data.id)});return c.json({passenger:created.data},201);}catch(error){return handleError(c,error);}});

async function updatePassengerAvatar(request:Request,spaceId:string,passengerId:string,parent=false):Promise<Row>{
  const user=await authenticate(request);let actorRole:'PARENT'|BusSpaceRole='PARENT';let parentAccessId:string|null=null;
  if(parent){const grants=await db.from('bus_app_parent_grants').select('parent_access_id').eq('user_id',user.id).is('revoked_at',null);if(grants.error)throw grants.error;const accessIds=rows(grants.data).map((item)=>text(item.parent_access_id));const active=accessIds.length?await db.from('bus_app_parent_access').select('id,bus_space_id').in('id',accessIds).is('revoked_at',null):{data:[],error:null};if(active.error)throw active.error;const activeIds=rows(active.data).map((item)=>text(item.id));const link=activeIds.length?await db.from('bus_app_parent_access_passengers').select('parent_access_id').eq('passenger_id',passengerId).in('parent_access_id',activeIds).limit(1).maybeSingle():{data:null,error:null};if(link.error)throw link.error;if(!link.data)throw new HttpError(403,'PASSENGER_AVATAR_FORBIDDEN','Geen toegang tot deze passagier.');const selected=rows(active.data).find((item)=>item.id===link.data?.parent_access_id);spaceId=text(selected?.bus_space_id);parentAccessId=text(link.data.parent_access_id);}
  else actorRole=(await accessForSpace(request,spaceId,['OWNER','ATTENDANT'])).role;
  const parsed=passengerAvatarSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)throw new HttpError(400,'INPUT_INVALID','Controleer de avatar.');
  const current=await db.from('bus_app_passengers').select('*').eq('id',passengerId).eq('bus_space_id',spaceId).eq('active',true).maybeSingle();if(current.error)throw current.error;if(!current.data)throw new HttpError(404,'PASSENGER_NOT_FOUND','Passagier niet gevonden.');
  const updated=await db.from('bus_app_passengers').update({avatar_source:'BUILT_IN',avatar_builtin_id:parsed.data.builtInAvatarId,avatar_asset_id:null,avatar_version:parsed.data.expectedVersion+1,avatar_updated_at:new Date().toISOString(),avatar_updated_by:user.id}).eq('id',passengerId).eq('avatar_version',parsed.data.expectedVersion).select('*').maybeSingle();if(updated.error)throw updated.error;if(!updated.data)throw new HttpError(409,'AVATAR_CONFLICT','De avatar is intussen gewijzigd.');
  await retireAvatarAsset(text(current.data.avatar_asset_id)||null);await emitAvatarPulse(await avatarRecipients(spaceId,'PASSENGER',passengerId),spaceId,'PASSENGER_AVATAR_UPDATED',passengerId);
  await db.from('bus_app_audit_events').insert({bus_space_id:spaceId,passenger_id:passengerId,parent_access_id:parentAccessId,actor_user_id:user.id,actor_role:actorRole,event_type:'PASSENGER_AVATAR_UPDATED'});
  return {passenger:{...updated.data,avatar:await avatarReference(updated.data as Row)}};
}

app.patch('/parent/passengers/:passengerId/avatar',async(c)=>{try{return c.json(await updatePassengerAvatar(c.req.raw,'',c.req.param('passengerId'),true));}catch(error){return handleError(c,error);}});
app.patch('/spaces/:spaceId/passengers/:passengerId/avatar',async(c)=>{try{return c.json(await updatePassengerAvatar(c.req.raw,c.req.param('spaceId'),c.req.param('passengerId')));}catch(error){return handleError(c,error);}});

app.patch('/spaces/:spaceId/buses/:busId/profile',async(c)=>{try{
  const access=await accessForSpace(c.req.raw,c.req.param('spaceId'));if(!hasBusSpacePermission(access,'MANAGE_BUS_PROFILE'))throw new HttpError(403,'BUS_PROFILE_FORBIDDEN','Je hebt geen toestemming om het busprofiel te wijzigen.');const parsed=busProfileSchema.safeParse(await c.req.json().catch(()=>null));if(!parsed.success)throw new HttpError(400,'INPUT_INVALID','Controleer het busprofiel.');
  const current=await db.from('bus_app_buses').select('*').eq('id',c.req.param('busId')).eq('bus_space_id',access.spaceId).eq('active',true).maybeSingle();if(current.error)throw current.error;if(!current.data)throw new HttpError(404,'BUS_NOT_FOUND','Bus niet gevonden.');
  const patch:Row={avatar_version:parsed.data.expectedVersion+1,avatar_updated_at:new Date().toISOString(),avatar_updated_by:access.user.id};if(parsed.data.name!==undefined)patch.name=parsed.data.name;if(parsed.data.builtInAvatarId!==undefined)Object.assign(patch,{avatar_source:'BUILT_IN',avatar_builtin_id:parsed.data.builtInAvatarId,avatar_asset_id:null});
  const updated=await db.from('bus_app_buses').update(patch).eq('id',c.req.param('busId')).eq('avatar_version',parsed.data.expectedVersion).select('*').maybeSingle();if(updated.error)throw updated.error;if(!updated.data)throw new HttpError(409,'BUS_PROFILE_CONFLICT','Het busprofiel is intussen gewijzigd.');
  if(parsed.data.builtInAvatarId!==undefined)await retireAvatarAsset(text(current.data.avatar_asset_id)||null);await emitAvatarPulse(await avatarRecipients(access.spaceId,'BUS',c.req.param('busId')),access.spaceId,'BUS_AVATAR_UPDATED',c.req.param('busId'));await audit(access,'BUS_PROFILE_UPDATED',{metadata:{busId:c.req.param('busId')}});
  return c.json({bus:{...updated.data,avatar:await avatarReference(updated.data as Row)}});
}catch(error){return handleError(c,error);}});

app.post('/spaces/:spaceId/parent-access',async(c)=>{try{const access=await accessForSpace(c.req.raw,c.req.param('spaceId'),['OWNER','ATTENDANT']);const parsed=parentAccessSchema.safeParse(await c.req.json().catch(()=>null));if(!parsed.success)throw new HttpError(400,'INPUT_INVALID','Controleer ouder en passagiers.');const passengers=await db.from('bus_app_passengers').select('id').eq('bus_space_id',access.spaceId).in('id',parsed.data.passengerIds).eq('active',true);if(passengers.error)throw passengers.error;if(rows(passengers.data).length!==new Set(parsed.data.passengerIds).size)throw new HttpError(404,'PASSENGER_NOT_FOUND','Passagier niet gevonden.');const code=newCode();const created=await db.from('bus_app_parent_access').insert({bus_space_id:access.spaceId,parent_display_name:parsed.data.parentDisplayName,code_hash:await hmac(normalizedCode(code)),created_by:access.user.id}).select('id,code_version').single();if(created.error)throw created.error;const links=await db.from('bus_app_parent_access_passengers').insert(parsed.data.passengerIds.map((passengerId)=>({parent_access_id:created.data.id,passenger_id:passengerId})));if(links.error)throw links.error;await audit(access,'PARENT_CODE_CREATED',{parentAccessId:text(created.data.id)});return c.json({parentAccessId:created.data.id,code,codeVersion:created.data.code_version},201);}catch(error){return handleError(c,error);}});

app.post('/spaces/:spaceId/parent-access/:accessId/regenerate',async(c)=>{try{const access=await accessForSpace(c.req.raw,c.req.param('spaceId'),['OWNER','ATTENDANT']);const current=await db.from('bus_app_parent_access').select('id,code_version').eq('id',c.req.param('accessId')).eq('bus_space_id',access.spaceId).is('revoked_at',null).maybeSingle();if(current.error)throw current.error;if(!current.data)throw new HttpError(404,'PARENT_ACCESS_NOT_FOUND','Oudertoegang niet gevonden.');const code=newCode();const updated=await db.from('bus_app_parent_access').update({code_hash:await hmac(normalizedCode(code)),code_version:numberValue(current.data.code_version)+1}).eq('id',current.data.id).select('code_version').single();if(updated.error)throw updated.error;await audit(access,'PARENT_CODE_REGENERATED',{parentAccessId:c.req.param('accessId')});return c.json({code,codeVersion:updated.data.code_version});}catch(error){return handleError(c,error);}});

app.post('/spaces/:spaceId/parent-access/:accessId/revoke',async(c)=>{try{const access=await accessForSpace(c.req.raw,c.req.param('spaceId'),['OWNER','ATTENDANT']);const now=new Date().toISOString();const target=await db.from('bus_app_parent_access').select('id').eq('id',c.req.param('accessId')).eq('bus_space_id',access.spaceId).maybeSingle();if(target.error)throw target.error;if(!target.data)throw new HttpError(404,'PARENT_ACCESS_NOT_FOUND','Oudertoegang niet gevonden.');const revoked=await db.from('bus_app_parent_grants').update({revoked_at:now}).eq('parent_access_id',target.data.id).is('revoked_at',null);if(revoked.error)throw revoked.error;await audit(access,'PARENT_GRANTS_REVOKED',{parentAccessId:text(target.data.id)});return c.json({ok:true});}catch(error){return handleError(c,error);}});

app.post('/parent/activate',async(c)=>{const started=Date.now();try{
  const user=await authenticate(c.req.raw);const parsed=activateParentSchema.safeParse(await c.req.json().catch(()=>null));if(!parsed.success)throw new HttpError(400,'CODE_INVALID','Deze code is niet geldig. Controleer de code of vraag een nieuwe aan je chauffeur.');
  const ipHash=await hmac(`ip:${ipAddress(c.req.raw)}`);const since=new Date(Date.now()-15*60_000).toISOString();const [deviceAttempts,ipAttempts]=await Promise.all([db.from('bus_app_code_attempts').select('id',{count:'exact',head:true}).eq('device_user_id',user.id).gte('attempted_at',since),db.from('bus_app_code_attempts').select('id',{count:'exact',head:true}).eq('ip_hash',ipHash).gte('attempted_at',since)]);if(deviceAttempts.error)throw deviceAttempts.error;if(ipAttempts.error)throw ipAttempts.error;if((deviceAttempts.count||0)>=8||(ipAttempts.count||0)>=20)throw new HttpError(429,'CODE_RATE_LIMITED','Te veel pogingen. Probeer later opnieuw.');
  const codeHash=await hmac(normalizedCode(parsed.data.code));const access=await db.from('bus_app_parent_access').select('id,bus_space_id').eq('code_hash',codeHash).is('revoked_at',null).maybeSingle();if(access.error)throw access.error;const success=Boolean(access.data);await db.from('bus_app_code_attempts').insert({device_user_id:user.id,ip_hash:ipHash,success,parent_access_id:access.data?.id||null});
  if(!access.data)throw new HttpError(400,'CODE_INVALID','Deze code is niet geldig. Controleer de code of vraag een nieuwe aan je chauffeur.');
  const grant=await db.from('bus_app_parent_grants').upsert({parent_access_id:access.data.id,user_id:user.id,revoked_at:null,last_seen_at:new Date().toISOString()},{onConflict:'parent_access_id,user_id'}).select('id').single();if(grant.error)throw grant.error;await db.from('bus_app_parent_access').update({last_used_at:new Date().toISOString()}).eq('id',access.data.id);await db.from('bus_app_audit_events').insert({bus_space_id:access.data.bus_space_id,parent_access_id:access.data.id,actor_user_id:user.id,actor_role:'PARENT',event_type:'PARENT_CODE_ACTIVATED'});
  const wait=Math.max(0,300-(Date.now()-started));if(wait)await new Promise((resolve)=>setTimeout(resolve,wait));return c.json({ok:true,grantId:grant.data.id});
}catch(error){const wait=Math.max(0,300-(Date.now()-started));if(wait)await new Promise((resolve)=>setTimeout(resolve,wait));return handleError(c,error);}});

app.get('/parent/home',async(c)=>{try{
  const user=await authenticate(c.req.raw);const grantId=c.req.query('grantId');let query=db.from('bus_app_parent_grants').select('id,parent_access_id').eq('user_id',user.id).is('revoked_at',null).order('last_seen_at',{ascending:false}).limit(1);if(grantId)query=query.eq('id',grantId);const grant=await query.maybeSingle();if(grant.error)throw grant.error;if(!grant.data)throw new HttpError(403,'PARENT_ACCESS_REQUIRED','Voer je buscode in.');
  const access=await db.from('bus_app_parent_access').select('id,bus_space_id,parent_display_name,revoked_at').eq('id',grant.data.parent_access_id).is('revoked_at',null).maybeSingle();if(access.error)throw access.error;if(!access.data)throw new HttpError(403,'PARENT_ACCESS_REVOKED','Deze toegang is ingetrokken.');
  const links=await db.from('bus_app_parent_access_passengers').select('passenger_id').eq('parent_access_id',access.data.id);if(links.error)throw links.error;const passengerIds=rows(links.data).map((item)=>text(item.passenger_id));
  const passengers=passengerIds.length?await db.from('bus_app_passengers').select('id,bus_space_id,stop_id,display_name,avatar_key,avatar_source,avatar_builtin_id,avatar_asset_id,avatar_version').in('id',passengerIds).eq('active',true):{data:[],error:null};if(passengers.error)throw passengers.error;const stopIds=[...new Set(rows(passengers.data).map((item)=>text(item.stop_id)))];const stops=stopIds.length?await db.from('bus_app_stops').select('id,bus_id,display_address,latitude,longitude').in('id',stopIds).eq('active',true):{data:[],error:null};if(stops.error)throw stops.error;const busId=text(rows(stops.data)[0]?.bus_id);const [space,bus,trip,profile]=await Promise.all([db.from('bus_app_spaces').select('id,name,avatar_key,default_language').eq('id',access.data.bus_space_id).single(),db.from('bus_app_buses').select('id,name,avatar_key,avatar_source,avatar_builtin_id,avatar_asset_id,avatar_version').eq('id',busId).maybeSingle(),db.from('bus_app_trips').select('*').eq('bus_id',busId).in('status',['BOARDING','IN_TRANSIT','ARRIVED']).order('created_at',{ascending:false}).limit(1).maybeSingle(),ensureProfile(user)]);if(space.error)throw space.error;if(bus.error)throw bus.error;if(trip.error)throw trip.error;
  let location:Row|null=null;let statuses:Row[]=[];let tripStops:Row[]=[];if(trip.data){const [locationResult,statusResult,tripStopResult]=await Promise.all([db.from('bus_app_trip_live_locations').select('latitude,longitude,captured_at').eq('trip_id',trip.data.id).maybeSingle(),db.from('bus_app_trip_passenger_statuses').select('passenger_id,status,version,trip_stop_id').eq('trip_id',trip.data.id).in('passenger_id',passengerIds),db.from('bus_app_trip_stops').select('id,source_stop_id,sequence,status,estimated_arrival_offset_seconds').eq('trip_id',trip.data.id).in('source_stop_id',stopIds)]);if(locationResult.error)throw locationResult.error;if(statusResult.error)throw statusResult.error;if(tripStopResult.error)throw tripStopResult.error;location=locationResult.data?{latitude:Math.round(numberValue(locationResult.data.latitude)*1000)/1000,longitude:Math.round(numberValue(locationResult.data.longitude)*1000)/1000,capturedAt:locationResult.data.captured_at}:null;statuses=rows(statusResult.data);tripStops=rows(tripStopResult.data);}
  await db.from('bus_app_parent_grants').update({last_seen_at:new Date().toISOString()}).eq('id',grant.data.id);
  const decoratedPassengers=await withAvatars(rows(passengers.data));return c.json({grantId:grant.data.id,parent:{displayName:text(profile.display_name)||access.data.parent_display_name,profile:{...profile,avatar:await avatarReference(profile)}},space:space.data,bus:await withAvatar(bus.data as Row|null),trip:trip.data?{id:trip.data.id,status:trip.data.status,currentStopSequence:trip.data.current_stop_sequence,startedAt:trip.data.started_at,location}:null,passengers:decoratedPassengers.map((passenger)=>{const stop=rows(stops.data).find((item)=>item.id===passenger.stop_id)||null;const status=statuses.find((item)=>item.passenger_id===passenger.id);const tripStop=tripStops.find((item)=>item.source_stop_id===passenger.stop_id);const eta=trip.data?.started_at&&tripStop?Math.max(0,Math.ceil((Date.parse(text(trip.data.started_at))+numberValue(tripStop.estimated_arrival_offset_seconds)*1000-Date.now())/60_000)):null;return {...passenger,stop,status:status?.status||'EXPECTED',statusVersion:numberValue(status?.version,1),etaMinutes:eta};})});
}catch(error){return handleError(c,error);}});

// A parent receives only the bus and staff identity needed for their own transport
// context. Membership lists, contact data and user identifiers never leave the server.
async function parentVisibleStaff(spaceId:string,tripCreatedBy:string|null):Promise<{driver:Row|null;attendant:Row|null}>{
  const members=await db.from('bus_app_members').select('user_id,role').eq('bus_space_id',spaceId).eq('active',true);if(members.error)throw members.error;
  const staff=rows(members.data).map((item)=>({userId:text(item.user_id),role:text(item.role) as BusSpaceRole})).filter((item)=>item.userId);
  const driver=staff.find((item)=>item.userId===tripCreatedBy&&item.role!=='ATTENDANT')||staff.find((item)=>item.role==='DRIVER')||staff.find((item)=>item.role==='OWNER')||null;
  const attendant=staff.find((item)=>item.role==='ATTENDANT'&&item.userId!==driver?.userId)||null;
  const userIds=[driver?.userId,attendant?.userId].filter((value):value is string=>Boolean(value));
  const profiles=userIds.length?await db.from('bus_app_profiles').select('user_id,display_name,avatar_source,avatar_builtin_id,avatar_asset_id,avatar_version').in('user_id',userIds):{data:[],error:null};
  if(profiles.error)throw profiles.error;
  const present=async(entry:{userId:string}|null,role:'DRIVER'|'ATTENDANT'):Promise<Row|null>=>{
    if(!entry)return null;
    const profile=rows(profiles.data).find((item)=>text(item.user_id)===entry.userId)||null;
    if(!profile)return null;
    return {displayName:text(profile.display_name),role,avatar:await avatarReference(profile)};
  };
  return {driver:await present(driver,'DRIVER'),attendant:await present(attendant,'ATTENDANT')};
}

app.get('/parent/bus-profile',async(c)=>{try{
  const user=await authenticate(c.req.raw);const grantId=c.req.query('grantId');
  let query=db.from('bus_app_parent_grants').select('id,parent_access_id').eq('user_id',user.id).is('revoked_at',null).order('last_seen_at',{ascending:false}).limit(1);if(grantId)query=query.eq('id',grantId);
  const grant=await query.maybeSingle();if(grant.error)throw grant.error;if(!grant.data)throw new HttpError(403,'PARENT_ACCESS_REQUIRED','Voer je buscode in.');
  const access=await db.from('bus_app_parent_access').select('id,bus_space_id').eq('id',grant.data.parent_access_id).is('revoked_at',null).maybeSingle();if(access.error)throw access.error;if(!access.data)throw new HttpError(403,'PARENT_ACCESS_REVOKED','Deze toegang is ingetrokken.');
  const spaceId=text(access.data.bus_space_id);
  const links=await db.from('bus_app_parent_access_passengers').select('passenger_id').eq('parent_access_id',access.data.id);if(links.error)throw links.error;
  const passengerIds=rows(links.data).map((item)=>text(item.passenger_id)).filter(Boolean);
  const passengers=passengerIds.length?await db.from('bus_app_passengers').select('id,stop_id').in('id',passengerIds).eq('bus_space_id',spaceId).eq('active',true):{data:[],error:null};if(passengers.error)throw passengers.error;
  const stopIds=[...new Set(rows(passengers.data).map((item)=>text(item.stop_id)).filter(Boolean))];
  const stops=stopIds.length?await db.from('bus_app_stops').select('id,bus_id,display_address').in('id',stopIds).eq('active',true):{data:[],error:null};if(stops.error)throw stops.error;
  const busId=text(rows(stops.data)[0]?.bus_id);if(!busId)throw new HttpError(404,'BUS_NOT_FOUND','Bus niet gevonden.');
  const bus=await db.from('bus_app_buses').select('id,name,avatar_source,avatar_builtin_id,avatar_asset_id,avatar_version').eq('id',busId).eq('bus_space_id',spaceId).eq('active',true).maybeSingle();if(bus.error)throw bus.error;if(!bus.data)throw new HttpError(404,'BUS_NOT_FOUND','Bus niet gevonden.');
  const trip=await db.from('bus_app_trips').select('status,created_by').eq('bus_id',busId).in('status',['BOARDING','IN_TRANSIT','ARRIVED']).order('created_at',{ascending:false}).limit(1).maybeSingle();if(trip.error)throw trip.error;
  const staff=await parentVisibleStaff(spaceId,text(trip.data?.created_by)||null);
  const ownStop=rows(stops.data)[0]||null;
  return c.json({bus:{displayName:text(bus.data.name),avatar:await avatarReference(bus.data as Row),currentTripStatus:trip.data?text(trip.data.status):null},driver:staff.driver,attendant:staff.attendant,ownStop:ownStop?{displayAddress:text(ownStop.display_address)}:null});
}catch(error){return handleError(c,error);}});

app.post('/spaces/:spaceId/routes/optimize',async(c)=>{try{
  const access=await accessForSpace(c.req.raw,c.req.param('spaceId'));if(!hasBusSpacePermission(access,'MANAGE_ROUTE'))throw new HttpError(403,'ROUTE_FORBIDDEN','Je hebt geen toestemming om de route te berekenen.');const recordRoute=await consumeRoutingQuota(access.user.id,'route.optimize',12);const routeStartedAt=Date.now();const parsed=optimizeRouteSchema.safeParse(await c.req.json().catch(()=>null));if(!parsed.success)throw new HttpError(400,'INPUT_INVALID','Controleer de routeopties.');
  const result=await mutateOnce(c.req.raw,access.user,'route.optimize',parsed.data,async()=>{const busResult=await db.from('bus_app_buses').select('*').eq('bus_space_id',access.spaceId).eq('active',true).limit(1).single();if(busResult.error)throw busResult.error;const bus=busResult.data as Row;const stopsResult=await db.from('bus_app_stops').select('*').eq('bus_id',bus.id).eq('active',true).order('manual_sequence');if(stopsResult.error)throw stopsResult.error;const stops=rows(stopsResult.data);if(!stops.length)throw new HttpError(422,'STOPS_REQUIRED','Voeg minstens één adres toe.');const points:Point[]=stops.map((stop)=>({id:text(stop.id),displayAddress:text(stop.display_address),latitude:numberValue(stop.latitude),longitude:numberValue(stop.longitude),expectedPassengerCount:numberValue(stop.expected_passenger_count)}));const input={start:{id:'start',displayAddress:text(bus.start_display_address),latitude:numberValue(bus.start_latitude),longitude:numberValue(bus.start_longitude),expectedPassengerCount:0},end:bus.end_latitude==null?null:{id:'end',displayAddress:text(bus.end_display_address),latitude:numberValue(bus.end_latitude),longitude:numberValue(bus.end_longitude),expectedPassengerCount:0},stops:points,roundTrip:parsed.data.roundTrip};const route=await optimizeRoute(input,parsed.data.mode,parsed.data.stopIds);await recordRoute(route.accuracy,route.provider,routeStartedAt);await db.from('bus_app_route_plans').update({selected_at:null}).eq('bus_id',bus.id).not('selected_at','is',null);const plan=await db.from('bus_app_route_plans').insert({bus_space_id:access.spaceId,bus_id:bus.id,provider:route.provider,optimization_mode:parsed.data.mode,distance_meters:route.distanceMeters,duration_seconds:route.durationSeconds,route_geometry:route.geometry,provider_metadata:route.metadata,created_by:access.user.id}).select('*').single();if(plan.error)throw plan.error;const byId=new Map(stops.map((stop)=>[text(stop.id),stop]));let cumulative=0;const snapshots=route.orderedStopIds.map((stopId,index)=>{const stop=byId.get(stopId)!;cumulative=Math.max(cumulative,route.arrivalOffsetsSeconds[stopId]||0);return{route_plan_id:plan.data.id,stop_id:stopId,sequence:index+1,estimated_arrival_offset_seconds:cumulative,display_address_snapshot:stop.display_address,latitude_snapshot:stop.latitude,longitude_snapshot:stop.longitude,expected_passenger_count_snapshot:stop.expected_passenger_count};});const inserted=await db.from('bus_app_route_plan_stops').insert(snapshots);if(inserted.error){await db.from('bus_app_route_plans').delete().eq('id',plan.data.id);throw inserted.error;}await audit(access,route.fallbackReason?'ROUTE_FALLBACK_USED':'ROUTE_CALCULATED',{metadata:{routePlanId:plan.data.id,provider:route.provider,accuracy:route.accuracy,geometrySource:route.geometrySource,...(route.fallbackReason?{fallbackReason:route.fallbackReason,attemptedProvider:configuredProvider()}:{})}});return{status:201,body:{routePlan:{...plan.data,stops:snapshots},accuracy:route.accuracy,geometrySource:route.geometrySource,...(route.fallbackReason?{fallbackReason:route.fallbackReason}:{})}};});return c.json(result.body,result.status as 201);
}catch(error){return handleError(c,error);}});

app.post('/spaces/:spaceId/trips/start',async(c)=>{try{const access=await accessForSpace(c.req.raw,c.req.param('spaceId'),['OWNER','DRIVER']);const body=await c.req.json().catch(()=>null) as Row|null;const routePlanId=text(body?.routePlanId);if(!routePlanId)throw new HttpError(400,'ROUTE_PLAN_REQUIRED','Bereken eerst een route.');const bus=await db.from('bus_app_buses').select('id').eq('bus_space_id',access.spaceId).eq('active',true).limit(1).single();if(bus.error)throw bus.error;const sessionId=crypto.randomUUID();const started=await db.rpc('bus_app_start_trip_snapshot',{p_bus_id:bus.data.id,p_route_plan_id:routePlanId,p_user_id:access.user.id,p_driver_session_id:sessionId});if(started.error){if(started.error.message?.includes('ROUTE_PLAN_STALE'))throw new HttpError(409,'ROUTE_PLAN_STALE','Bereken de route opnieuw.');throw started.error;}await audit(access,'TRIP_CREATED',{tripId:text(started.data)});return c.json({tripId:started.data,driverSessionId:sessionId},201);}catch(error){return handleError(c,error);}});

app.get('/spaces/:spaceId/trip',async(c)=>{try{const access=await accessForSpace(c.req.raw,c.req.param('spaceId'));const trip=await db.from('bus_app_trips').select('*').eq('bus_space_id',access.spaceId).in('status',['BOARDING','IN_TRANSIT','ARRIVED']).order('created_at',{ascending:false}).limit(1).maybeSingle();if(trip.error)throw trip.error;if(!trip.data)return c.json({role:access.role,trip:null});const [bus,stops,statuses]=await Promise.all([db.from('bus_app_buses').select('id,name,avatar_key,avatar_source,avatar_builtin_id,avatar_asset_id,avatar_version').eq('id',trip.data.bus_id).single(),db.from('bus_app_trip_stops').select('*').eq('trip_id',trip.data.id).order('sequence'),db.from('bus_app_trip_passenger_statuses').select('*').eq('trip_id',trip.data.id).order('display_name_snapshot')]);if(bus.error)throw bus.error;if(stops.error)throw stops.error;if(statuses.error)throw statuses.error;const statusRows=rows(statuses.data);const passengerIds=statusRows.map((status)=>text(status.passenger_id));const current=passengerIds.length?await db.from('bus_app_passengers').select('id,avatar_source,avatar_builtin_id,avatar_asset_id,avatar_version').in('id',passengerIds):{data:[],error:null};if(current.error)throw current.error;const decoratedCurrent=await withAvatars(rows(current.data));const stopRows=rows(stops.data);const nextStop=stopRows.find((stop)=>!['COMPLETED','SKIPPED'].includes(text(stop.status)))||null;return c.json({role:access.role,trip:{...trip.data,bus:await withAvatar(bus.data as Row),stops:stopRows,nextStop,passengers:statusRows.filter((status)=>!nextStop||status.trip_stop_id===nextStop.id).map((status)=>({...status,avatar:decoratedCurrent.find((item)=>item.id===status.passenger_id)?.avatar||{source:'BUILT_IN',builtInAvatarId:null,assetId:null,version:1,photoUrl:null}}))}});}catch(error){return handleError(c,error);}});

app.post('/trips/:tripId/location',async(c)=>{try{const {access,trip}=await tripAccess(c.req.raw,c.req.param('tripId'),['OWNER','DRIVER']);const parsed=locationSchema.safeParse(await c.req.json().catch(()=>null));if(!parsed.success)throw new HttpError(400,'INPUT_INVALID','Ongeldige GPS-update.');if(text(trip.driver_session_id)!==parsed.data.driverSessionId)throw new HttpError(409,'DRIVER_SESSION_INVALID','De actieve GPS-sessie klopt niet.');if(!['BOARDING','IN_TRANSIT'].includes(text(trip.status)))throw new HttpError(409,'TRIP_NOT_ACTIVE','Deze rit is niet actief.');if(Math.abs(Date.now()-Date.parse(parsed.data.capturedAt))>5*60_000)throw new HttpError(400,'LOCATION_STALE','De GPS-update is te oud.');const location={trip_id:trip.id,bus_space_id:access.spaceId,bus_id:trip.bus_id,driver_session_id:parsed.data.driverSessionId,latitude:parsed.data.latitude,longitude:parsed.data.longitude,accuracy_meters:parsed.data.accuracyMeters||null,speed_mps:parsed.data.speedMps||null,captured_at:parsed.data.capturedAt};const live=await db.from('bus_app_trip_live_locations').upsert(location);if(live.error)throw live.error;const history=await db.from('bus_app_trip_location_events').insert(location);if(history.error)throw history.error;const nextStop=await db.from('bus_app_trip_stops').select('*').eq('trip_id',trip.id).in('status',['PENDING','APPROACHING','AT_STOP']).order('sequence').limit(1).maybeSingle();if(nextStop.error)throw nextStop.error;if(nextStop.data){const passengerRows=await db.from('bus_app_trip_passenger_statuses').select('passenger_id').eq('trip_id',trip.id).eq('trip_stop_id',nextStop.data.id);if(passengerRows.error)throw passengerRows.error;const recipients=await parentRecipientsForPassengers(rows(passengerRows.data).map((item)=>text(item.passenger_id)));if(recipients.targets.length){await db.from('bus_app_parent_trip_updates').insert(recipients.targets.map((target)=>({user_id:target.userId,parent_access_id:target.parentAccessId,trip_id:trip.id,event_type:'LOCATION_UPDATED'})));}const distance=distanceMeters(parsed.data.latitude,parsed.data.longitude,numberValue(nextStop.data.latitude),numberValue(nextStop.data.longitude));if(text(nextStop.data.status)==='PENDING'&&distance<=numberValue(nextStop.data.geofence_radius_meters,100)*1.5){await db.from('bus_app_trip_stops').update({status:'APPROACHING',approached_at:new Date().toISOString()}).eq('id',nextStop.data.id).eq('status','PENDING');const space=await db.from('bus_app_spaces').select('default_language').eq('id',access.spaceId).single();if(space.error)throw space.error;await notifyBusAppEvent(db,{...recipients,tripId:text(trip.id),eventType:'BUS_APPROACHING',locale:text(space.data.default_language)==='fr'?'fr':'nl'});}}await db.rpc('purge_expired_bus_app_runtime_data');return c.json({ok:true});}catch(error){return handleError(c,error);}});

app.post('/trips/:tripId/attendance',async(c)=>{try{const {access,trip}=await tripAccess(c.req.raw,c.req.param('tripId'),['OWNER','ATTENDANT']);const parsed=attendanceSchema.safeParse(await c.req.json().catch(()=>null));if(!parsed.success)throw new HttpError(400,'INPUT_INVALID','Controleer de aanwezigheid.');const updated=await db.from('bus_app_trip_passenger_statuses').update({status:parsed.data.status,version:parsed.data.expectedVersion+1,changed_by:access.user.id,changed_at:new Date().toISOString()}).eq('trip_id',trip.id).eq('passenger_id',parsed.data.passengerId).eq('version',parsed.data.expectedVersion).select('*').maybeSingle();if(updated.error)throw updated.error;if(!updated.data)throw new HttpError(409,'ATTENDANCE_CONFLICT','De status is al gewijzigd. Vernieuw de rit.');await audit(access,`PASSENGER_${parsed.data.status}`,{tripId:text(trip.id),passengerId:parsed.data.passengerId});if(['BOARDED','DROPPED_OFF'].includes(parsed.data.status)){const recipients=await parentRecipientsForPassengers([parsed.data.passengerId]);const space=await db.from('bus_app_spaces').select('default_language').eq('id',access.spaceId).single();if(space.error)throw space.error;await notifyBusAppEvent(db,{...recipients,tripId:text(trip.id),eventType:`PASSENGER_${parsed.data.status}`,locale:text(space.data.default_language)==='fr'?'fr':'nl'});}return c.json({status:updated.data});}catch(error){return handleError(c,error);}});

app.post('/trips/:tripId/stops/:tripStopId',async(c)=>{try{const {access,trip}=await tripAccess(c.req.raw,c.req.param('tripId'),['OWNER','DRIVER','ATTENDANT']);const parsed=stopActionSchema.safeParse(await c.req.json().catch(()=>null));if(!parsed.success)throw new HttpError(400,'INPUT_INVALID','Controleer de halteactie.');const map={APPROACH:'APPROACHING',ARRIVE:'AT_STOP',COMPLETE:'COMPLETED',SKIP:'SKIPPED'} as const;const timestamps:Row={};if(parsed.data.action==='APPROACH')timestamps.approached_at=new Date().toISOString();if(parsed.data.action==='ARRIVE')timestamps.arrived_at=new Date().toISOString();if(parsed.data.action==='COMPLETE')timestamps.completed_at=new Date().toISOString();const updated=await db.from('bus_app_trip_stops').update({status:map[parsed.data.action],...timestamps}).eq('id',c.req.param('tripStopId')).eq('trip_id',trip.id).select('*').maybeSingle();if(updated.error)throw updated.error;if(!updated.data)throw new HttpError(404,'TRIP_STOP_NOT_FOUND','Halte niet gevonden.');if(['COMPLETE','SKIP'].includes(parsed.data.action))await db.from('bus_app_trips').update({current_stop_sequence:updated.data.sequence}).eq('id',trip.id);await audit(access,`STOP_${parsed.data.action}`,{tripId:text(trip.id),metadata:{tripStopId:updated.data.id}});return c.json({stop:updated.data});}catch(error){return handleError(c,error);}});

app.post('/trips/:tripId/transition',async(c)=>{try{const {access,trip}=await tripAccess(c.req.raw,c.req.param('tripId'),['OWNER','DRIVER']);const parsed=transitionSchema.safeParse(await c.req.json().catch(()=>null));if(!parsed.success)throw new HttpError(400,'INPUT_INVALID','Controleer de ritactie.');const transitions:Record<string,{from:string[];to:string;timestamp:string}>={START:{from:['BOARDING'],to:'IN_TRANSIT',timestamp:'started_at'},ARRIVE:{from:['IN_TRANSIT'],to:'ARRIVED',timestamp:'arrived_at'},COMPLETE:{from:['ARRIVED'],to:'COMPLETED',timestamp:'completed_at'},CANCEL:{from:['BOARDING','IN_TRANSIT','ARRIVED'],to:'CANCELLED',timestamp:'cancelled_at'}};const transition=transitions[parsed.data.transition];if(!transition.from.includes(text(trip.status)))throw new HttpError(409,'TRIP_TRANSITION_INVALID','Deze ritactie is niet mogelijk.');const updated=await db.from('bus_app_trips').update({status:transition.to,[transition.timestamp]:new Date().toISOString()}).eq('id',trip.id).eq('status',trip.status).select('*').maybeSingle();if(updated.error)throw updated.error;if(!updated.data)throw new HttpError(409,'TRIP_CONFLICT','De ritstatus is al gewijzigd.');await audit(access,`TRIP_${transition.to}`,{tripId:text(trip.id)});const passengerRows=await db.from('bus_app_trip_passenger_statuses').select('passenger_id').eq('trip_id',trip.id);if(passengerRows.error)throw passengerRows.error;const recipients=await parentRecipientsForPassengers(rows(passengerRows.data).map((item)=>text(item.passenger_id)));const space=await db.from('bus_app_spaces').select('default_language').eq('id',access.spaceId).single();if(space.error)throw space.error;if(['IN_TRANSIT','CANCELLED'].includes(transition.to))await notifyBusAppEvent(db,{...recipients,tripId:text(trip.id),eventType:transition.to==='IN_TRANSIT'?'BUS_STARTED':'TRIP_CANCELLED',locale:text(space.data.default_language)==='fr'?'fr':'nl'});return c.json({trip:updated.data});}catch(error){return handleError(c,error);}});

app.get('/notifications',async(c)=>{try{const user=await authenticate(c.req.raw);const result=await db.from('bus_app_notifications').select('*').eq('user_id',user.id).order('created_at',{ascending:false}).limit(50);if(result.error)throw result.error;return c.json({notifications:rows(result.data)});}catch(error){return handleError(c,error);}});
app.post('/push/subscribe',async(c)=>{try{const user=await authenticate(c.req.raw);const parsed=pushSubscriptionSchema.safeParse(await c.req.json().catch(()=>null));if(!parsed.success)throw new HttpError(400,'INPUT_INVALID','Ongeldig pushabonnement.');const result=await db.from('bus_app_push_subscriptions').upsert({user_id:user.id,endpoint:parsed.data.endpoint,p256dh:parsed.data.keys.p256dh,auth:parsed.data.keys.auth,enabled:true,revoked_at:null},{onConflict:'user_id,endpoint'});if(result.error)throw result.error;return c.json({ok:true});}catch(error){return handleError(c,error);}});

function handleError(c:{json:(body:unknown,status?:number)=>Response},error:unknown):Response {
  if(error instanceof HttpError || error instanceof RoutingError)return c.json({error:error.code,message:error.message},error.status);
  const record=error&&typeof error==='object'?error as Row:{};const code=text(record.code);console.error('[bus-app] request failed',{code:code||'UNKNOWN',message:error instanceof Error?error.message:'unknown'});
  if(code==='23505')return c.json({error:'CONFLICT',message:'Deze gegevens bestaan al.'},409);
  return c.json({error:'BUS_APP_UNAVAILABLE',message:'BusApp is tijdelijk niet beschikbaar.'},500);
}

Deno.serve(app.fetch);
