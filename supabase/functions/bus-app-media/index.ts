import { Hono } from 'npm:hono@4.5.10';
import { createClient, type User } from 'jsr:@supabase/supabase-js@2';
import { corsPreflight, withCors } from '../_shared/cors.ts';
import { sanitizeAvatarImage, type AvatarImageKind } from './image.ts';
import { detectImageFormat } from './image-core.ts';

type Row = Record<string, unknown>;
type Role = 'OWNER' | 'DRIVER' | 'ATTENDANT';
type Target = {
  kind: 'PROFILE' | 'PASSENGER' | 'BUS';
  entityId: string;
  busSpaceId: string | null;
  currentAssetId: string | null;
  version: number;
  parentAccessId?: string;
  actorRole: 'PROFILE' | 'PARENT' | Role;
};

const app = new Hono().basePath('/bus-app-media');
const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } } as const;
const authClient = createClient(supabaseUrl, anonKey, options);
const db = createClient(supabaseUrl, serviceKey, options);
const bucket = 'bus-app-private-media';
const maxUploadBytes = 5 * 1024 * 1024;
const acceptedDeclaredTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

if (!supabaseUrl || !anonKey || !serviceKey) console.error('[bus-app-media] Supabase environment is incomplete');
app.use('*', async (c, next) => { if (c.req.method === 'OPTIONS') return corsPreflight(c.req.raw); await next(); c.res = withCors(c.req.raw, c.res); });

class HttpError extends Error { constructor(readonly status: number, readonly code: string, message: string) { super(message); } }
function text(value: unknown): string { return typeof value === 'string' ? value : ''; }
function rows(value: unknown): Row[] { return Array.isArray(value) ? value.filter((item): item is Row => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : []; }
function numberValue(value: unknown, fallback = 0): number { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }

async function authenticate(request: Request): Promise<User> {
  const authorization = String(request.headers.get('authorization') || '').trim();
  if (!authorization.startsWith('Bearer ')) throw new HttpError(401, 'AUTH_REQUIRED', 'Connexion requise.');
  const result = await authClient.auth.getUser(authorization.slice(7).trim());
  if (result.error || !result.data.user) throw new HttpError(401, 'AUTH_INVALID', 'La session a expiré.');
  return result.data.user;
}

async function membership(user: User, spaceId: string, roles: Role[]): Promise<Role> {
  const result = await db.from('bus_app_members').select('role').eq('bus_space_id', spaceId).eq('user_id', user.id).eq('active', true).in('role', roles).limit(1).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new HttpError(403, 'BUS_SPACE_ACCESS_REQUIRED', 'Geen toegang tot deze bus.');
  return text(result.data.role) as Role;
}

async function ensureProfile(user: User): Promise<Row> {
  const current = await db.from('bus_app_profiles').select('*').eq('user_id', user.id).maybeSingle();
  if (current.error) throw current.error;
  if (current.data) return current.data as Row;
  const metadata = user.user_metadata && typeof user.user_metadata === 'object' ? user.user_metadata as Row : {};
  const fallback = text(metadata.display_name).trim() || text(metadata.name).trim() || String(user.email || '').split('@')[0] || 'BusApp';
  const created = await db.from('bus_app_profiles').insert({ user_id: user.id, display_name: fallback.slice(0, 50), language: text(metadata.language) === 'fr' ? 'fr' : 'nl', updated_by: user.id }).select('*').single();
  if (created.error) throw created.error;
  return created.data as Row;
}

async function parentPassengerTarget(user: User, passengerId: string): Promise<Target> {
  const grants = await db.from('bus_app_parent_grants').select('parent_access_id').eq('user_id', user.id).is('revoked_at', null);
  if (grants.error) throw grants.error;
  const accessIds = rows(grants.data).map((item) => text(item.parent_access_id)).filter(Boolean);
  if (!accessIds.length) throw new HttpError(403, 'PARENT_ACCESS_REQUIRED', 'Voer je buscode in.');
  const activeAccess = await db.from('bus_app_parent_access').select('id,bus_space_id').in('id', accessIds).is('revoked_at', null);
  if (activeAccess.error) throw activeAccess.error;
  const activeIds = rows(activeAccess.data).map((item) => text(item.id));
  const link = activeIds.length ? await db.from('bus_app_parent_access_passengers').select('parent_access_id').eq('passenger_id', passengerId).in('parent_access_id', activeIds).limit(1).maybeSingle() : { data: null, error: null };
  if (link.error) throw link.error;
  if (!link.data) throw new HttpError(403, 'PASSENGER_AVATAR_FORBIDDEN', 'Geen toegang tot deze passagier.');
  const access = rows(activeAccess.data).find((item) => item.id === link.data?.parent_access_id);
  const passenger = await db.from('bus_app_passengers').select('id,bus_space_id,avatar_asset_id,avatar_version').eq('id', passengerId).eq('bus_space_id', access?.bus_space_id).eq('active', true).maybeSingle();
  if (passenger.error) throw passenger.error;
  if (!passenger.data) throw new HttpError(404, 'PASSENGER_NOT_FOUND', 'Passagier niet gevonden.');
  return { kind: 'PASSENGER', entityId: passengerId, busSpaceId: text(passenger.data.bus_space_id), currentAssetId: text(passenger.data.avatar_asset_id) || null, version: numberValue(passenger.data.avatar_version, 1), parentAccessId: text(link.data.parent_access_id), actorRole: 'PARENT' };
}

async function resolveTarget(request: Request, kind: Target['kind'], spaceId?: string, entityId?: string, parent = false): Promise<{ user: User; target: Target }> {
  const user = await authenticate(request);
  if (kind === 'PROFILE') {
    const profile = await ensureProfile(user);
    return { user, target: { kind, entityId: user.id, busSpaceId: null, currentAssetId: text(profile.avatar_asset_id) || null, version: numberValue(profile.avatar_version, 1), actorRole: 'PROFILE' } };
  }
  if (!entityId) throw new HttpError(400, 'ENTITY_REQUIRED', 'Profiel ontbreekt.');
  if (parent) return { user, target: await parentPassengerTarget(user, entityId) };
  if (!spaceId) throw new HttpError(400, 'BUS_SPACE_REQUIRED', 'Busruimte ontbreekt.');
  if (kind === 'PASSENGER') {
    const role = await membership(user, spaceId, ['OWNER', 'ATTENDANT']);
    const passenger = await db.from('bus_app_passengers').select('id,bus_space_id,avatar_asset_id,avatar_version').eq('id', entityId).eq('bus_space_id', spaceId).eq('active', true).maybeSingle();
    if (passenger.error) throw passenger.error;
    if (!passenger.data) throw new HttpError(404, 'PASSENGER_NOT_FOUND', 'Passagier niet gevonden.');
    return { user, target: { kind, entityId, busSpaceId: spaceId, currentAssetId: text(passenger.data.avatar_asset_id) || null, version: numberValue(passenger.data.avatar_version, 1), actorRole: role } };
  }
  const role = await membership(user, spaceId, ['OWNER']);
  const bus = await db.from('bus_app_buses').select('id,bus_space_id,avatar_asset_id,avatar_version').eq('id', entityId).eq('bus_space_id', spaceId).eq('active', true).maybeSingle();
  if (bus.error) throw bus.error;
  if (!bus.data) throw new HttpError(404, 'BUS_NOT_FOUND', 'Bus niet gevonden.');
  return { user, target: { kind, entityId, busSpaceId: spaceId, currentAssetId: text(bus.data.avatar_asset_id) || null, version: numberValue(bus.data.avatar_version, 1), actorRole: role } };
}

async function fileBytes(request: Request): Promise<Uint8Array> {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > maxUploadBytes + 512 * 1024) throw new HttpError(413, 'IMAGE_TOO_LARGE', 'Kies een foto van maximaal 5 MB.');
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'IMAGE_REQUIRED', 'Kies eerst een foto.');
  if (file.size < 1 || file.size > maxUploadBytes) throw new HttpError(413, 'IMAGE_TOO_LARGE', 'Kies een foto van maximaal 5 MB.');
  if (!acceptedDeclaredTypes.has(file.type.toLowerCase())) throw new HttpError(415, 'IMAGE_TYPE_INVALID', 'Kies een JPG, PNG of WebP.');
  const bytes=new Uint8Array(await file.arrayBuffer());const detected=detectImageFormat(bytes);const declared=file.type.toLowerCase();
  const expected=detected==='JPEG'?'image/jpeg':detected==='PNG'?'image/png':detected==='WEBP'?'image/webp':'';
  if(!expected||declared!==expected)throw new HttpError(415,'IMAGE_MAGIC_MISMATCH','Het bestandstype van deze foto klopt niet.');
  return bytes;
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function storagePrefix(target: Target): string {
  if (target.kind === 'PROFILE') return `profiles/${target.entityId}`;
  const plural = target.kind === 'BUS' ? 'buses' : 'passengers';
  return `spaces/${target.busSpaceId}/${plural}/${target.entityId}`;
}

async function pulseRecipients(target: Target): Promise<string[]> {
  if (target.kind === 'PROFILE') return [target.entityId];
  const members = await db.from('bus_app_members').select('user_id').eq('bus_space_id', target.busSpaceId).eq('active', true);
  if (members.error) throw members.error;
  const recipients = rows(members.data).map((item) => text(item.user_id));
  if (target.kind === 'PASSENGER') {
    const links = await db.from('bus_app_parent_access_passengers').select('parent_access_id').eq('passenger_id', target.entityId);
    if (links.error) throw links.error;
    const accessIds = rows(links.data).map((item) => text(item.parent_access_id));
    const access = accessIds.length ? await db.from('bus_app_parent_access').select('id').in('id', accessIds).is('revoked_at', null) : { data: [], error: null };
    if (access.error) throw access.error;
    const activeIds = rows(access.data).map((item) => text(item.id));
    const grants = activeIds.length ? await db.from('bus_app_parent_grants').select('user_id').in('parent_access_id', activeIds).is('revoked_at', null) : { data: [], error: null };
    if (grants.error) throw grants.error;
    recipients.push(...rows(grants.data).map((item) => text(item.user_id)));
  } else {
    const access = await db.from('bus_app_parent_access').select('id').eq('bus_space_id', target.busSpaceId).is('revoked_at', null);
    if (access.error) throw access.error;
    const accessIds = rows(access.data).map((item) => text(item.id));
    const grants = accessIds.length ? await db.from('bus_app_parent_grants').select('user_id').in('parent_access_id', accessIds).is('revoked_at', null) : { data: [], error: null };
    if (grants.error) throw grants.error;
    recipients.push(...rows(grants.data).map((item) => text(item.user_id)));
  }
  return [...new Set(recipients.filter(Boolean))];
}

async function replaceReference(user: User, target: Target, assetId: string): Promise<void> {
  const now = new Date().toISOString();
  const values = { avatar_source: 'UPLOAD', avatar_builtin_id: null, avatar_asset_id: assetId, avatar_version: target.version + 1, avatar_updated_at: now, avatar_updated_by: user.id };
  let updated;
  if (target.kind === 'PROFILE') updated = await db.from('bus_app_profiles').update({ avatar_source: values.avatar_source, avatar_builtin_id: null, avatar_asset_id: assetId, avatar_version: values.avatar_version, updated_at: now, updated_by: user.id }).eq('user_id', target.entityId).eq('avatar_version', target.version).select('user_id').maybeSingle();
  else if (target.kind === 'PASSENGER') updated = await db.from('bus_app_passengers').update(values).eq('id', target.entityId).eq('bus_space_id', target.busSpaceId).eq('avatar_version', target.version).select('id').maybeSingle();
  else updated = await db.from('bus_app_buses').update(values).eq('id', target.entityId).eq('bus_space_id', target.busSpaceId).eq('avatar_version', target.version).select('id').maybeSingle();
  if (updated.error) { console.error('[bus-app-media] reference update rejected',updated.error);throw new HttpError(500,`PHOTO_REFERENCE_${text(updated.error.code)||'FAILED'}`,'De foto kon niet aan het profiel worden gekoppeld.'); }
  if (!updated.data) throw new HttpError(409, 'AVATAR_CONFLICT', 'De avatar is intussen gewijzigd. Probeer opnieuw.');
}

async function upload(request: Request, targetKind: Target['kind'], spaceId?: string, entityId?: string, parent = false): Promise<Row> {
  const [{ user, target }, input] = await Promise.all([resolveTarget(request, targetKind, spaceId, entityId, parent), fileBytes(request)]);
  let processed;
  try { processed = sanitizeAvatarImage(input, target.kind === 'BUS' ? 'BUS' : 'PROFILE' as AvatarImageKind); }
  catch { throw new HttpError(415, 'INVALID_IMAGE', 'Deze foto kon niet worden gebruikt. Kies een JPG, PNG of WebP van maximaal 5 MB.'); }
  const assetId = crypto.randomUUID();
  const prefix = storagePrefix(target);
  const storagePath = `${prefix}/${assetId}.webp`;
  const thumbnailPath = `${prefix}/${assetId}-thumb.webp`;
  const fullUpload = await db.storage.from(bucket).upload(storagePath, processed.full, { contentType: 'image/webp', cacheControl: '300', upsert: false });
  if (fullUpload.error) { console.error('[bus-app-media] full upload failed',fullUpload.error); throw new HttpError(500,'PHOTO_STORAGE_FAILED','De foto kon niet veilig worden opgeslagen.'); }
  const thumbnailUpload = await db.storage.from(bucket).upload(thumbnailPath, processed.thumbnail, { contentType: 'image/webp', cacheControl: '300', upsert: false });
  if (thumbnailUpload.error) { console.error('[bus-app-media] thumbnail upload failed',thumbnailUpload.error);await db.storage.from(bucket).remove([storagePath]); throw new HttpError(500,'PHOTO_STORAGE_FAILED','De foto kon niet veilig worden opgeslagen.'); }
  const asset = await db.from('bus_app_avatar_assets').insert({ id: assetId, bus_space_id: target.busSpaceId, profile_user_id: target.kind === 'PROFILE' ? target.entityId : null, passenger_id: target.kind === 'PASSENGER' ? target.entityId : null, bus_id: target.kind === 'BUS' ? target.entityId : null, storage_path: storagePath, thumbnail_storage_path: thumbnailPath, size_bytes: processed.full.byteLength, thumbnail_size_bytes: processed.thumbnail.byteLength, width: processed.width, height: processed.height, thumbnail_width: processed.thumbnailWidth, thumbnail_height: processed.thumbnailHeight, content_sha256: await sha256(processed.full), created_by: user.id }).select('*').single();
  if (asset.error) { console.error('[bus-app-media] asset registration failed',asset.error);await db.storage.from(bucket).remove([storagePath, thumbnailPath]); throw new HttpError(500,'PHOTO_ASSET_FAILED','De foto kon niet aan het profiel worden gekoppeld.'); }
  try { await replaceReference(user, target, assetId); }
  catch (error) { console.error('[bus-app-media] avatar reference failed',error);await db.from('bus_app_avatar_assets').delete().eq('id', assetId); await db.storage.from(bucket).remove([storagePath, thumbnailPath]); if(error instanceof HttpError)throw error;throw new HttpError(500,'PHOTO_REFERENCE_FAILED','De foto kon niet aan het profiel worden gekoppeld.'); }
  try { const recipients = await pulseRecipients(target); if (recipients.length) await db.from('bus_app_avatar_updates').insert(recipients.map((userId) => ({ user_id: userId, bus_space_id: target.busSpaceId, event_type: `${target.kind}_AVATAR_UPDATED`, entity_id: target.entityId }))); }
  catch (reason) { console.error('[bus-app-media] avatar pulse failed after successful reference update', reason); }
  try { await db.from('bus_app_audit_events').insert({ bus_space_id: target.busSpaceId, passenger_id: target.kind === 'PASSENGER' ? target.entityId : null, parent_access_id: target.parentAccessId || null, actor_user_id: user.id, actor_role: target.actorRole, event_type: `${target.kind}_AVATAR_PHOTO_UPDATED`, metadata: { assetId } }); }
  catch (reason) { console.error('[bus-app-media] avatar audit failed after successful reference update', reason); }
  if (target.currentAssetId) {
    const old = await db.from('bus_app_avatar_assets').select('storage_path,thumbnail_storage_path').eq('id', target.currentAssetId).maybeSingle();
    await db.from('bus_app_avatar_assets').update({ status: 'REPLACED', replaced_at: new Date().toISOString() }).eq('id', target.currentAssetId);
    if (old.data) await db.storage.from(bucket).remove([text(old.data.storage_path), text(old.data.thumbnail_storage_path)].filter(Boolean));
  }
  const signed = await db.storage.from(bucket).createSignedUrl(thumbnailPath, 300);
  return { avatar: { source: 'UPLOAD', builtInAvatarId: null, assetId, version: target.version + 1, photoUrl: signed.error ? null : signed.data.signedUrl } };
}

app.get('/health', (c) => c.json({ ok: true, service: 'bus-app-media', bucket, formats: ['JPEG', 'PNG', 'WEBP'], maxUploadBytes, output: 'WEBP', metadata: 'STRIPPED' }));
app.post('/profile', async (c) => { try { return c.json(await upload(c.req.raw, 'PROFILE'), 201); } catch (error) { return handleError(c, error); } });
app.post('/parent/passengers/:passengerId', async (c) => { try { return c.json(await upload(c.req.raw, 'PASSENGER', undefined, c.req.param('passengerId'), true), 201); } catch (error) { return handleError(c, error); } });
app.post('/spaces/:spaceId/passengers/:passengerId', async (c) => { try { return c.json(await upload(c.req.raw, 'PASSENGER', c.req.param('spaceId'), c.req.param('passengerId')), 201); } catch (error) { return handleError(c, error); } });
app.post('/spaces/:spaceId/buses/:busId', async (c) => { try { return c.json(await upload(c.req.raw, 'BUS', c.req.param('spaceId'), c.req.param('busId')), 201); } catch (error) { return handleError(c, error); } });

function handleError(c: { json: (body: unknown, status?: number) => Response }, error: unknown): Response {
  if (error instanceof HttpError) return c.json({ error: error.code, message: error.message }, error.status);
  const record = error && typeof error === 'object' ? error as Row : {};
  console.error('[bus-app-media] request failed', { code: text(record.code) || 'UNKNOWN', message: error instanceof Error ? error.message : 'unknown' });
  return c.json({ error: 'UPLOAD_FAILED', message: 'Deze foto kon niet worden verwerkt.' }, 500);
}

Deno.serve(app.fetch);
