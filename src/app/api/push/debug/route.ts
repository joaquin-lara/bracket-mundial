import { createClient as createAdmin } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import webpush from 'web-push';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Push diagnostics. Open /api/push/debug in the logged-in app: reports whether
 * the VAPID/Supabase env vars are set, how many subscriptions you have, and
 * attempts a real test send to your devices, surfacing the actual error.
 * Safe — it only reveals booleans/counts (no secret values) and only pushes to
 * the signed-in user's own devices. Remove once push is confirmed working.
 */
export async function GET() {
  const env = {
    vapidPublic: !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    vapidPrivate: !!process.env.VAPID_PRIVATE_KEY,
    vapidSubject: process.env.VAPID_SUBJECT || '(default)',
    serviceRole: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    supabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
  };

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ loggedIn: false, env, hint: 'Open this while signed in to the app.' });
  if (!env.serviceRole || !env.supabaseUrl) return NextResponse.json({ loggedIn: true, env, error: 'Supabase server env vars missing' });

  const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: mySubs, error: subErr } = await admin
    .from('push_subscriptions')
    .select('id,endpoint,p256dh,auth')
    .eq('user_id', user.id);
  const { count: totalSubscriptions } = await admin
    .from('push_subscriptions')
    .select('*', { count: 'exact', head: true });

  const send: { attempted: boolean; sent: number; errors: string[] } = { attempted: false, sent: 0, errors: [] };
  if (env.vapidPublic && env.vapidPrivate && mySubs && mySubs.length) {
    send.attempted = true;
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:notify@stonksbracket.app',
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!
    );
    const body = JSON.stringify({ title: '✅ Push debug test', body: 'If you see this, notifications work!', url: '/' });
    for (const s of mySubs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body);
        send.sent++;
      } catch (e) {
        const err = e as { statusCode?: number; body?: string; message?: string };
        send.errors.push(`${err.statusCode ?? ''} ${err.body || err.message || String(e)}`.trim().slice(0, 300));
      }
    }
  }

  return NextResponse.json({
    loggedIn: true,
    userEmail: user.email ?? null,
    userId: user.id,
    env,
    mySubscriptions: mySubs?.length ?? 0,
    totalSubscriptions: totalSubscriptions ?? 0,
    subQueryError: subErr?.message ?? null,
    send,
  });
}
