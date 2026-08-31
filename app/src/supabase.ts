import { createClient } from '@supabase/supabase-js';
const url=String(import.meta.env.VITE_SUPABASE_URL||'');
const publicKey=String(import.meta.env.SUPABASE_PUBLISHABLE_KEY||import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY||'');
if(!url||!publicKey)throw new Error('BusApp public Supabase configuration is missing.');
export const supabase=createClient(url,publicKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:'wexio-bus-app-auth-v2'},realtime:{heartbeatIntervalMs:15_000}});
export const busAppApiUrl=`${url}/functions/v1/bus-app`;
export const busAppMediaUrl=`${url}/functions/v1/bus-app-media`;
export const busAppPublicKey=publicKey;
