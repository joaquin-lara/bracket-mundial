import { createClient as createAdmin } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// Open /push-test INSIDE the installed app (PWA). It runs as the app's logged-in
// account (on iOS that differs from Safari), reports your saved subscriptions, and
// sends a test push right now. Remove once push is confirmed.
export default async function PushTest() {
  const box: React.CSSProperties = { font: '15px/1.5 system-ui, sans-serif', padding: 24, maxWidth: 640 };
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return <main style={box}><h2>Push test</h2><p>Not signed in here. Open this from inside the app while logged in.</p></main>;
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return <main style={box}><h2>Push test</h2><p>Server env vars missing.</p></main>;
    const admin = createAdmin(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('id,endpoint,p256dh,auth')
      .eq('user_id', user.id);

    let sent = 0;
    const errors: string[] = [];
    const haveKeys = !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY;
    if (haveKeys && subs && subs.length) {
      const webpush = (await import('web-push')).default;
      webpush.setVapidDetails(
        process.env.VAPID_SUBJECT || 'mailto:notify@stonksbracket.app',
        process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
        process.env.VAPID_PRIVATE_KEY!
      );
      const body = JSON.stringify({ title: '✅ It works!', body: 'Stonks notifications are live on your phone.', url: '/' });
      for (const s of subs) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body);
          sent++;
        } catch (e) {
          const err = e as { statusCode?: number; body?: string; message?: string };
          errors.push(`${err.statusCode ?? ''} ${err.body || err.message || String(e)}`.trim().slice(0, 300));
        }
      }
    }

    return (
      <main style={box}>
        <h2>Push test</h2>
        <p>Signed in as <strong>{user.email}</strong></p>
        <p>Your saved devices: <strong>{subs?.length ?? 0}</strong></p>
        <p>Test pushes sent: <strong>{sent}</strong></p>
        {errors.length > 0 && (
          <pre style={{ whiteSpace: 'pre-wrap', background: '#fee', padding: 12, borderRadius: 8 }}>{errors.join('\n')}</pre>
        )}
        <p style={{ marginTop: 16, color: '#555' }}>
          {sent > 0
            ? 'A notification should appear now. If it does, tell me and I’ll remove this page.'
            : (subs?.length ?? 0) === 0
              ? 'No devices saved for THIS account. The account this app is logged into has no subscription — enable notifications in this app, or log in as the account that does.'
              : 'Could not send — see errors above.'}
        </p>
      </main>
    );
  } catch (e) {
    return (
      <main style={box}>
        <h2>Push test — error</h2>
        <pre style={{ whiteSpace: 'pre-wrap', background: '#fee', padding: 12, borderRadius: 8 }}>
          {e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e)}
        </pre>
      </main>
    );
  }
}
