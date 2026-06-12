import { createClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { fetchFixtures, fetchFootballDataMatchDetail } from '@/lib/footballData';
import { runSync } from '@/lib/sync';
import { makeSupabaseSyncDb } from '@/lib/syncDb';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  // Vercel Cron / GitHub Actions send "Authorization: Bearer <CRON_SECRET>".
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!, // bypasses RLS; server only
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  try {
    const apiKey = process.env.FOOTBALL_DATA_API_KEY;
    const source = process.env.FIXTURES_SOURCE ?? 'football-data';
    const detailFn =
      source !== 'openfootball' && apiKey
        ? (id: number) => fetchFootballDataMatchDetail(apiKey, id)
        : undefined;
    const result = await runSync(makeSupabaseSyncDb(admin), fetchFixtures, detailFn);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
