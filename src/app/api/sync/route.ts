import { createClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { fetchFixtures } from '@/lib/footballData';
import { runSync } from '@/lib/sync';
import { makeSupabaseSyncDb } from '@/lib/syncDb';
import { runMatchNotifications } from '@/lib/push/notify';
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

  try {
    const result = await runSync(makeSupabaseSyncDb(admin), fetchFixtures);
    // After scores are fresh, fire any due push notifications (best-effort).
    const notified = await runMatchNotifications(admin);
    // Evaluate achievements server-side too, so new unlocks notify the earner
    // even when nobody has a page open. Best-effort.
    await ensureAchievements().catch(() => {});
    return NextResponse.json({ ok: true, ...result, notified });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
