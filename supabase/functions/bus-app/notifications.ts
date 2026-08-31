import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
// @ts-types="npm:@types/web-push@3.6.4"
import webPush from 'npm:web-push@3.6.7';

type NotifyInput = {
  userIds: string[];
  targets?: Array<{ userId:string; parentAccessId:string }>;
  tripId: string;
  eventType: string;
  locale: 'nl'|'fr';
};

type Subscription = { id: string; endpoint: string; p256dh: string; auth: string };
let configured = false;

const copy: Record<string, { nl: [string,string]; fr: [string,string] }> = {
  BUS_STARTED: { nl:['🚌 De bus is vertrokken','De bus is onderweg.'], fr:['🚌 Le bus est parti','Le bus est en route.'] },
  BUS_APPROACHING: { nl:['🚌 De bus komt eraan','De bus nadert jouw halte.'], fr:['🚌 Le bus arrive','Le bus approche de votre arrêt.'] },
  PASSENGER_BOARDED: { nl:['✅ Op de bus','Je passagier is als aanwezig geregistreerd.'], fr:['✅ À bord','Votre passager est enregistré comme présent.'] },
  PASSENGER_DROPPED_OFF: { nl:['✅ Afgezet','Je passagier is als afgezet geregistreerd.'], fr:['✅ Déposé','Votre passager est enregistré comme déposé.'] },
  TRIP_CANCELLED: { nl:['⚠ Rit geannuleerd','De busrit gaat niet door.'], fr:['⚠ Trajet annulé','Le trajet en bus est annulé.'] },
};

function configure(): boolean {
  if (configured) return true;
  const subject = String(Deno.env.get('WEB_PUSH_SUBJECT') || '');
  const publicKey = String(Deno.env.get('WEB_PUSH_PUBLIC_KEY') || '');
  const privateKey = String(Deno.env.get('WEB_PUSH_PRIVATE_KEY') || '');
  if (!subject || !publicKey || !privateKey) return false;
  webPush.setVapidDetails(subject, publicKey, privateKey); configured = true; return true;
}

export function webPushPublicKey(): string | null {
  const value = String(Deno.env.get('WEB_PUSH_PUBLIC_KEY') || '').trim();
  return value || null;
}

export async function notifyBusAppEvent(db: SupabaseClient, input: NotifyInput): Promise<void> {
  const users = [...new Set(input.userIds.filter(Boolean))];
  if (!users.length) return;
  const [title,message] = copy[input.eventType]?.[input.locale] || (input.locale === 'fr' ? ['🚌 Mise à jour BusApp','Une information de trajet est disponible.'] : ['🚌 BusApp-update','Er is nieuwe ritinformatie.']);
  const notificationRows = users.map((userId) => ({ user_id:userId, trip_id:input.tripId, event_type:input.eventType, title, message }));
  const inserted = await db.from('bus_app_notifications').insert(notificationRows);
  if (inserted.error) console.warn('[bus-app] notification insert failed', inserted.error.code);
  if (input.targets?.length) {
    const pulseRows = input.targets.map((target) => ({ user_id:target.userId, parent_access_id:target.parentAccessId, trip_id:input.tripId, event_type:input.eventType }));
    const pulse = await db.from('bus_app_parent_trip_updates').insert(pulseRows);
    if (pulse.error) console.warn('[bus-app] parent pulse failed', pulse.error.code);
  }
  if (!configure()) return;
  const subscriptions = await db.from('bus_app_push_subscriptions').select('id,endpoint,p256dh,auth').in('user_id',users).eq('enabled',true).is('revoked_at',null);
  if (subscriptions.error) { console.warn('[bus-app] subscription lookup failed', subscriptions.error.code); return; }
  const payload = JSON.stringify({ title, body:message, icon:'/icons/icon-192.png', badge:'/icons/icon-192.png', data:{ url:'/', tripId:input.tripId, eventType:input.eventType } });
  for (const subscription of (subscriptions.data || []) as Subscription[]) {
    try { await webPush.sendNotification({ endpoint:subscription.endpoint, keys:{ p256dh:subscription.p256dh, auth:subscription.auth } }, payload, { TTL:300, urgency:'high' }); }
    catch (error) {
      const status = error && typeof error === 'object' ? Number((error as Record<string,unknown>).statusCode) : 0;
      if (status === 404 || status === 410) await db.from('bus_app_push_subscriptions').update({ enabled:false, revoked_at:new Date().toISOString() }).eq('id',subscription.id);
      else console.warn('[bus-app] push delivery failed', status || 'unknown');
    }
  }
}
