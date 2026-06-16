import { createClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { broadcast, sendToUser } from '@/lib/push/webpush';

export const dynamic = 'force-dynamic';

// Allow the local send-notification.html (file:// origin) to call this.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/**
 * Admin push sender. Authenticate with the CRON_SECRET (Bearer or ?secret=).
 * Body: { title, body, url?, targetEmail? }. With no targetEmail it broadcasts
 * to everyone; with one it sends only to that account's devices.
 */
export async function POST(req: NextRequest) {
  // Accept either the existing CRON_SECRET or a dedicated PUSH_ADMIN_SECRET
  // (so you can set a secret you actually know, without touching CRON_SECRET).
  const secrets = [process.env.CRON_SECRET, process.env.PUSH_ADMIN_SECRET].filter(Boolean) as string[];
  const url = new URL(req.url);
  const provided = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || url.searchParams.get('secret') || '';
  if (!provided || !secrets.includes(provided)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS });
  }

  const payload = await req.json().catch(() => null);
  if (!payload?.title || !payload?.body) {
    return NextResponse.json({ error: 'title and body required' }, { status: 400, headers: CORS });
  }

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const msg = { title: String(payload.title), body: String(payload.body), url: payload.url ? String(payload.url) : '/' };

  try {
    if (payload.targetEmail) {
      const { data } = await admin.auth.admin.listUsers();
      const target = data.users.find((u) => u.email?.toLowerCase() === String(payload.targetEmail).toLowerCase());
      if (!target) return NextResponse.json({ error: `no account for ${payload.targetEmail}` }, { status: 404, headers: CORS });
      const sent = await sendToUser(admin, target.id, msg);
      return NextResponse.json({ ok: true, target: target.email, sent }, { headers: CORS });
    }
    const sent = await broadcast(admin, msg);
    return NextResponse.json({ ok: true, broadcast: true, sent }, { headers: CORS });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'error' }, { status: 500, headers: CORS });
  }
}
