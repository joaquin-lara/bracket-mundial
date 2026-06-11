/**
 * Fallback seeder: loads WC 2026 fixtures from the free openfootball dataset
 * (no API key needed) straight into Supabase.
 *
 * Use ONLY if football-data.org's free tier turns out not to include the
 * 2026 World Cup. Also set FIXTURES_SOURCE=openfootball in .env.local and on
 * Vercel so the cron keeps syncing scores from the same source.
 *
 * Run:  npm run seed:openfootball
 */
import { readFileSync } from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { fetchOpenfootballFixtures } from '../src/lib/footballData';

function loadEnvLocal() {
  try {
    const raw = readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    // no .env.local; rely on the environment
  }
}

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first.');
    process.exit(1);
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log('Fetching openfootball 2026 fixtures…');
  const fixtures = await fetchOpenfootballFixtures();
  console.log(`Got ${fixtures.length} fixtures. Upserting…`);

  const { error } = await admin
    .from('matches')
    .upsert(
      fixtures.map((f) => ({ ...f, updated_at: new Date().toISOString() })),
      { onConflict: 'id' }
    );
  if (error) {
    console.error('Upsert failed:', error.message);
    process.exit(1);
  }
  console.log('Done. Fixtures are in the matches table.');
}

main();
