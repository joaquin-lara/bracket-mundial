import { createClient as createAdmin } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Server missing Supabase service-role env vars');
  return createAdmin(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Save a PushSubscription for the signed-in user. */
export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

    const sub = await req.json().catch(() => null);
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      return NextResponse.json({ error: 'bad subscription' }, { status: 400 });
    }

    // Service role: upsert by endpoint (a device re-subscribing, or switching user).
    const { error } = await admin()
      .from('push_subscriptions')
      .upsert(
        { user_id: user.id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
        { onConflict: 'endpoint' }
      );
    if (error) return NextResponse.json({ error: `DB: ${error.message}` }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'server error' }, { status: 500 });
  }
}

/** Remove a subscription (used when the user turns notifications off). */
export async function DELETE(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { endpoint } = await req.json().catch(() => ({ endpoint: null }));
  if (endpoint) await admin().from('push_subscriptions').delete().eq('endpoint', endpoint);
  return NextResponse.json({ ok: true });
}
