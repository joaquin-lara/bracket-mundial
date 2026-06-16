import { createClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { fetchFixtures } from '@/lib/footballData';
import { runSync } from '@/lib/sync';
import { makeSupabaseSyncDb } from '@/lib/syncDb';
import { runMatchNotifications } from '@/lib/push/notify';
import { ensureAchievements } from '@/lib/achievementsSync';
import { sendToUser } from '@/lib/push/webpush';

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

    // TEMP one-off test push at ~1:30 AM New York time on 2026-06-16, sent only
    // to the account owner. Safe to delete this whole block afterwards.
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(new Date());
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
      const ymd = `${get('year')}-${get('month')}-${get('day')}`;
      const hh = Number(get('hour'));
      const mm = Number(get('minute'));
      if (ymd === '2026-06-16' && hh === 1 && mm >= 30 && mm < 45) {
        const { data } = await admin.auth.admin.listUsers();
        const me = data.users.find((u) => u.email === 'joaquinlara490@gmail.com');
        if (me) {
          await sendToUser(admin, me.id, {
            title: '✅ Stonks test notification',
            body: 'Lock-screen notifications are working! You can remove this test now.',
            url: '/',
            tag: 'test-130',
          });
        }
      }
    } catch {
      /* test push is best-effort */
    }

    return NextResponse.json({ ok: true, ...result, notified });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
