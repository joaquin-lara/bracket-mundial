import { createClient as createAdmin } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit, clientIp } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

// Max sizes for subscription fields
const MAX_ENDPOINT_LEN = 2048;
const MAX_KEY_LEN = 512;
const MAX_BODY_BYTES = 4 * 1024;

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Server missing Supabase service-role env vars');
  return createAdmin(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Save a PushSubscription for the signed-in user. */
export async function POST(req: NextRequest) {
  try {
    // Rate limit: 20 per minute per IP
    const ip = clientIp(req);
    if (!checkRateLimit(`push:subscribe:${ip}`, 20, 60 * 1000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    // Reject oversized payloads
    const contentLength = Number(req.headers.get('content-length') ?? 0);
    if (contentLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

    const sub = await req.json().catch(() => null);
    if (
      !sub?.endpoint ||
      typeof sub.endpoint !== 'string' ||
      !sub?.keys?.p256dh ||
      typeof sub.keys.p256dh !== 'string' ||
      !sub?.keys?.auth ||
      typeof sub.keys.auth !== 'string'
    ) {
      return NextResponse.json({ error: 'bad subscription' }, { status: 400 });
    }

    // Validate field lengths
    if (
      sub.endpoint.length > MAX_ENDPOINT_LEN ||
      sub.keys.p256dh.length > MAX_KEY_LEN ||
      sub.keys.auth.length > MAX_KEY_LEN
    ) {
      return NextResponse.json({ error: 'subscription fields too long' }, { status: 400 });
    }

    // Validate endpoint is a well-formed https URL
    try {
      const epUrl = new URL(sub.endpoint);
      if (epUrl.protocol !== 'https:') throw new Error('non-https endpoint');
    } catch {
      return NextResponse.json({ error: 'invalid endpoint URL' }, { status: 400 });
    }

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
  // Rate limit: 20 per minute per IP
  const ip = clientIp(req);
  if (!checkRateLimit(`push:unsubscribe:${ip}`, 20, 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({ endpoint: null }));
  const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : null;
  if (endpoint) {
    await admin().from('push_subscriptions').delete().eq('endpoint', endpoint).eq('user_id', user.id);
  }
  return NextResponse.json({ ok: true });
}
