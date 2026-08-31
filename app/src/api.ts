import { busAppApiUrl, busAppPublicKey, supabase } from './supabase';

type ApiOptions={method?:'GET'|'POST'|'PATCH';body?:unknown;idempotent?:boolean;idempotencyKey?:string};
export class BusAppApiError extends Error { constructor(readonly code:string,message:string,readonly status:number){super(message);} }

export async function api<T>(path:string,options:ApiOptions={}):Promise<T>{
  const session=await supabase.auth.getSession();const token=session.data.session?.access_token;
  if(!token)throw new BusAppApiError('AUTH_REQUIRED','Authentication required.',401);
  const response=await fetch(`${busAppApiUrl}${path}`,{method:options.method||'GET',headers:{authorization:`Bearer ${token}`,apikey:busAppPublicKey,'content-type':'application/json',...(options.idempotent||options.idempotencyKey?{'idempotency-key':options.idempotencyKey||crypto.randomUUID()}:{})},...(options.body===undefined?{}:{body:JSON.stringify(options.body)})});
  const payload=await response.json().catch(()=>({})) as Record<string,unknown>;
  if(!response.ok)throw new BusAppApiError(String(payload.error||'BUS_APP_UNAVAILABLE'),String(payload.message||'BusApp unavailable.'),response.status);
  return payload as T;
}
