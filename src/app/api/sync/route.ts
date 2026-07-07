import { createClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { fetchFixtures } from '@/lib/footballData';
import { runSync } from '@/lib/sync';
import { makeSupabaseSyncDb } from '@/lib/syncDb';
import { runMatchNotifications } from '@/lib/push/notify';
import { runLineupSync } from '@/lib/lineupSync';
import { runStatsSync } from '@/lib/statsSync';
import { ensureAchievements } from '@/lib/achievementsSync';
import { ensureGamblerSettlement } from '@/lib/gamblers';
import { checkRateLimit, clientIp } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  // Rate limit: 5 per 15 minutes per IP (brute-force guard on CRON_SECRET)
  const ip = clientIp(request);
  if (!checkRateLimit(`sync:${ip}`, 5, 15 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

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

  // notifyOnly=1: fire any due push notifications and nothing else.
  if (new URL(request.url).searchParams.get('notifyOnly') === '1') {
    const notified = await runMatchNotifications(admin);
    return NextResponse.json({ ok: true, notifyOnly: true, notified });
  }

  let result: Record<string, unknown> = {};
  try {
    result = { ...(await runSync(makeSupabaseSyncDb(admin), fetchFixtures)) };
  } catch (err) {
    result = { syncError: err instanceof Error ? err.message : String(err) };
  }

  const notified = await runMatchNotifications(admin);
  const lineups = await runLineupSync(admin);
  const stats = await runStatsSync(admin);
  await ensureAchievements().catch(() => {});
  await ensureGamblerSettlement(admin).catch(() => {});
  return NextResponse.json({ ok: true, ...result, notified, lineups, stats });
}
