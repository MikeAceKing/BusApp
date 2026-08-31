#!/usr/bin/env node
// Reports BusApp profiles whose personal display name looks like it was seeded from a bus
// name, back when the profile card fell back to the Bus Space name.
//
// This script NEVER writes. A name matching the bus is a strong hint, not proof: a driver is
// free to call themselves after their bus. Nothing is corrected automatically; the report
// exists so a human can decide, and so the affected users can simply edit their own profile.
//
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/audit-profile-name-drift.mjs [--json]

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required. This script only reads.');
  process.exit(2);
}

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const normalize = (value) => String(value || '').trim().toLocaleLowerCase();

const [profiles, members, buses, spaces] = await Promise.all([
  db.from('bus_app_profiles').select('user_id,display_name,created_at,updated_at'),
  db.from('bus_app_members').select('user_id,bus_space_id,role').eq('active', true),
  db.from('bus_app_buses').select('id,bus_space_id,name').eq('active', true),
  db.from('bus_app_spaces').select('id,name'),
]);
for (const result of [profiles, members, buses, spaces]) if (result.error) throw result.error;

const spaceName = new Map((spaces.data || []).map((space) => [space.id, space.name]));
const busNamesBySpace = new Map();
for (const bus of buses.data || []) {
  if (!busNamesBySpace.has(bus.bus_space_id)) busNamesBySpace.set(bus.bus_space_id, []);
  busNamesBySpace.get(bus.bus_space_id).push(bus.name);
}

const findings = [];
for (const profile of profiles.data || []) {
  const memberships = (members.data || []).filter((member) => member.user_id === profile.user_id);
  for (const membership of memberships) {
    const candidates = [...(busNamesBySpace.get(membership.bus_space_id) || []), spaceName.get(membership.bus_space_id)];
    const matched = candidates.find((candidate) => candidate && normalize(candidate) === normalize(profile.display_name));
    if (!matched) continue;
    findings.push({
      userId: profile.user_id,
      displayName: profile.display_name,
      matches: matched,
      busSpaceId: membership.bus_space_id,
      role: membership.role,
      // A profile never edited since creation is the likelier accident.
      everEdited: profile.updated_at !== profile.created_at,
    });
    break;
  }
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ scanned: (profiles.data || []).length, findings }, null, 2));
} else {
  console.log(`Scanned ${(profiles.data || []).length} BusApp profiles.`);
  if (!findings.length) console.log('No profile display name matches a bus or Bus Space name.');
  for (const finding of findings) {
    console.log(`- ${finding.userId} (${finding.role}) display_name "${finding.displayName}" equals "${finding.matches}"${finding.everEdited ? ' — profile was edited since creation, likely deliberate' : ' — never edited, review'}`);
  }
  console.log('\nNo data was changed. Affected users can correct this themselves via Profiel > Profiel aanpassen.');
}
