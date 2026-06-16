import { createClient as createAdmin } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sendToUser } from '@/lib/push/webpush';

export const dynamic = 'force-dynamic';

/** Push the challenged player a notification when a penalty-shootout duel is created. */
export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const { duelId } = await req.json().catch(() => ({ duelId: null }));
    if (!duelId) return NextResponse.json({ error: 'missing duelId' }, { status: 400 });

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });
    const admin = createAdmin(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    // Confirm the caller is this duel's challenger, then notify the opponent.
    const { data: duel } = await admin.from('duels').select('challenger, opponent').eq('id', duelId).maybeSingle();
    if (!duel || duel.challenger !== user.id) {
      return NextResponse.json({ error: 'not your duel' }, { status: 403 });
    }
    const { data: prof } = await admin.from('profiles').select('display_name').eq('id', user.id).maybeSingle();
    const name = (prof?.display_name as string) || 'Someone';

    await sendToUser(admin, duel.opponent as string, {
      title: '🥅 Penalty shootout challenge!',
      body: `${name} challenged you to a duel — tap to respond.`,
      url: '/duels',
      tag: `duel-${duelId}`,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'error' }, { status: 500 });
  }
}
