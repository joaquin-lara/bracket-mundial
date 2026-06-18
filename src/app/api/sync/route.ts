import { createClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { fetchFixtures } from '@/lib/footballData';
import { runSync } from '@/lib/sync';
import { makeSupabaseSyncDb } from '@/lib/syncDb';
import { runMatchNotifications } from '@/lib/push/notify';
import { runLineupSync } from '@/lib/lineupSync';
import { ensureAchievements } from '@/lib/achievementsSync';

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

  // Update fixtures/scores; a sync failure must NOT stop notifications.
  let result: Record<string, unknown> = {};
  try {
    result = { ...(await runSync(makeSupabaseSyncDb(admin), fetchFixtures)) };
  } catch (err) {
    result = { syncError: err instanceof Error ? err.message : String(err) };
  }

  const notified = await runMatchNotifications(admin);
  const lineups = await runLineupSync(admin);
  await ensureAchievements().catch(() => {});
  return NextResponse.json({ ok: true, ...result, notified, lineups });
}
