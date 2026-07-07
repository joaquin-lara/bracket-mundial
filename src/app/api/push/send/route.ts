import { createClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { broadcast, sendToUser } from '@/lib/push/webpush';
import { checkRateLimit, clientIp, verifyAnySecret } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

// Max payload size: 8 KB — enough for any push notification body
const MAX_BODY_BYTES = 8 * 1024;
// Max field lengths
const MAX_TITLE = 200;
const MAX_BODY_TEXT = 500;
const MAX_URL_LEN = 300;

// CORS: only the app's own origin. The local send-notification helper should
// call the endpoint server-side (e.g. via curl / a script) rather than from
// a browser file:// page.
const origin = process.env.NEXT_PUBLIC_APP_URL ?? '';
const CORS = {
  'Access-Control-Allow-Origin': origin || 'null',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/** Only allow relative paths so push URLs can never redirect off-domain. */
function sanitizeUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '/';
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/')) return '/';
  // Strip any embedded newlines or null bytes
  return trimmed.replace(/[\r\n\0]/g, '').slice(0, MAX_URL_LEN);
}

/**
 * Admin push sender. Authenticate with CRON_SECRET (Bearer or ?secret=).
 * Body: { title, body, url?, targetEmail? }
 * Rate-limited to 5 requests per 15 minutes per IP.
 */
export async function POST(req: NextRequest) {
  // Rate limit: 5 per 15 minutes per IP (brute-force guard on the secret)
  const ip = clientIp(req);
  if (!checkRateLimit(`push:send:${ip}`, 5, 15 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: CORS });
  }

  // Reject oversized payloads before parsing JSON
  const contentLength = Number(req.headers.get('content-length') ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413, headers: CORS });
  }

  // Timing-safe secret verification
  const secrets = [process.env.CRON_SECRET, process.env.PUSH_ADMIN_SECRET].filter(Boolean) as string[];
  const url = new URL(req.url);
  const provided = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || url.searchParams.get('secret') || '';
  if (!verifyAnySecret(provided, secrets)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS });
  }

  const payload = await req.json().catch(() => null);
  if (!payload?.title || !payload?.body) {
    return NextResponse.json({ error: 'title and body required' }, { status: 400, headers: CORS });
  }

  // Validate and clamp field lengths
  const title = String(payload.title).slice(0, MAX_TITLE);
  const body = String(payload.body).slice(0, MAX_BODY_TEXT);
  const notifUrl = sanitizeUrl(payload.url);

  const msg = { title, body, url: notifUrl };

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    if (payload.targetEmail) {
      const targetEmail = String(payload.targetEmail).toLowerCase().trim();
      const { data } = await admin.auth.admin.listUsers();
      const target = data.users.find((u) => u.email?.toLowerCase() === targetEmail);
      // Return the same response shape whether found or not to prevent enumeration
      if (!target) {
        return NextResponse.json({ ok: true, sent: 0 }, { headers: CORS });
      }
      const sent = await sendToUser(admin, target.id, msg);
      return NextResponse.json({ ok: true, sent }, { headers: CORS });
    }
    const sent = await broadcast(admin, msg);
    return NextResponse.json({ ok: true, broadcast: true, sent }, { headers: CORS });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'error' }, { status: 500, headers: CORS });
  }
}
