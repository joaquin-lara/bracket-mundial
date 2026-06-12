import { createClient } from '@supabase/supabase-js';
import { fetchFixtures, fetchFootballDataMatchDetail } from './footballData';
import { runSync } from './sync';
import { makeSupabaseSyncDb } from './syncDb';

const STALE_MS = 5 * 60_000; // sync at most every 5 minutes

let inFlight: Promise<void> | null = null;

/**
 * Lazy auto-sync: called from match pages on render. If the newest matches
 * row is older than 5 minutes, pull fresh fixtures/scores from the API and
 * score any finished games. Single-flight so concurrent page loads share one
 * sync. Never throws: a sync failure must not break page rendering.
 */
export async function ensureFreshScores(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = doSync().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doSync(): Promise<void> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key || !process.env.FOOTBALL_DATA_API_KEY) return;

    const admin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data } = await admin
      .from('matches')
      .select('updated_at')
      .order('updated_at', { ascending: false })
      .limit(1);

    const newest = data?.[0]?.updated_at ? new Date(data[0].updated_at as string).getTime() : 0;
    if (Date.now() - newest < STALE_MS) return;

    const source = process.env.FIXTURES_SOURCE ?? 'football-data';
    const detailFn =
      source !== 'openfootball' && process.env.FOOTBALL_DATA_API_KEY
        ? (id: number) => fetchFootballDataMatchDetail(process.env.FOOTBALL_DATA_API_KEY!, id)
        : undefined;
    await runSync(makeSupabaseSyncDb(admin), fetchFixtures, detailFn);
  } catch (err) {
    console.error('auto-sync failed:', err instanceof Error ? err.message : err);
  }
}
