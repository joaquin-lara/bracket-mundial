import webpush from 'web-push';
import type { SupabaseClient } from '@supabase/supabase-js';

let configured = false;
/** Lazy VAPID setup so a missing key only matters when we actually send. */
function configure(): boolean {
  if (configured) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:notify@stonksbracket.app', pub, priv);
  configured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

export interface SubRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Send a payload to specific subscription rows; prune expired/gone ones. */
export async function sendToSubs(admin: SupabaseClient, subs: SubRow[], payload: PushPayload): Promise<number> {
  if (!configure() || subs.length === 0) return 0;
  const body = JSON.stringify(payload);
  const dead: string[] = [];
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body);
        sent++;
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) dead.push(s.id); // subscription gone
      }
    })
  );
  if (dead.length) await admin.from('push_subscriptions').delete().in('id', dead);
  return sent;
}

/** Broadcast a payload to every subscriber. */
export async function broadcast(admin: SupabaseClient, payload: PushPayload): Promise<number> {
  const { data } = await admin.from('push_subscriptions').select('id,endpoint,p256dh,auth');
  return sendToSubs(admin, (data as SubRow[]) ?? [], payload);
}
