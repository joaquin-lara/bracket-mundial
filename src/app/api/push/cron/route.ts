import { createClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { fetchFixtures } from '@/lib/footballData';
import { runSync } from '@/lib/sync';
import { makeSupabaseSyncDb } from '@/lib/syncDb';
import { broadcast } from '@/lib/push/webpush';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface MatchRow {
  id: string;
  home_team: string;
  away_team: string;
  kickoff: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  notif_pre: boolean;
  notif_start: boolean;
  notif_home_score: number;
  notif_away_score: number;
}

const PRE_MIN = 10; // minutes before kickoff for the reminder

// Cron-driven push sender. Run this every ~1 minute (Vercel Pro cron or an
// external pinger) with "Authorization: Bearer <CRON_SECRET>". Each match fires
// at most one pre-kickoff reminder, one kickoff alert, and a live goal alert per
// goal, de-duplicated by flags on the matches row.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  // 1) Refresh fixtures/scores so goal detection sees live data (best-effort).
  try {
    await runSync(makeSupabaseSyncDb(admin), fetchFixtures);
  } catch {
    /* keep going with whatever scores we have */
  }

  // 2) Look at matches around now: upcoming (next 15 min) and recently live (3h).
  const now = Date.now();
  const from = new Date(now - 3 * 60 * 60 * 1000).toISOString();
  const to = new Date(now + 15 * 60 * 1000).toISOString();
  const { data: matches } = await admin
    .from('matches')
    .select('id,home_team,away_team,kickoff,status,home_score,away_score,notif_pre,notif_start,notif_home_score,notif_away_score')
    .gte('kickoff', from)
    .lte('kickoff', to);

  const sent: string[] = [];
  for (const m of (matches as MatchRow[]) ?? []) {
    const kickoff = Date.parse(m.kickoff);
    const minsToKickoff = (kickoff - now) / 60000;
    const hs = m.home_score ?? 0;
    const as = m.away_score ?? 0;
    const tag = `match-${m.id}`;
    const patch: Record<string, unknown> = {};

    if (!m.notif_start && now >= kickoff) {
      // Kickoff: alert, and baseline the score so we never announce a goal that
      // happened before we started watching (e.g. if the cron missed earlier).
      await broadcast(admin, {
        title: '🟢 Kickoff!',
        body: `${m.home_team} vs ${m.away_team} is underway.`,
        url: '/matches',
        tag,
      });
      patch.notif_start = true;
      patch.notif_home_score = hs;
      patch.notif_away_score = as;
      sent.push(`start ${m.id}`);
    } else if (m.notif_start && hs + as > m.notif_home_score + m.notif_away_score) {
      // A goal (or goals) since we last looked.
      const scorer = hs > m.notif_home_score ? m.home_team : m.away_team;
      await broadcast(admin, {
        title: `⚽ GOAL — ${scorer}!`,
        body: `${m.home_team} ${hs}–${as} ${m.away_team}`,
        url: '/matches',
        tag,
      });
      patch.notif_home_score = hs;
      patch.notif_away_score = as;
      sent.push(`goal ${m.id}`);
    }

    if (!m.notif_pre && minsToKickoff > 0 && minsToKickoff <= PRE_MIN) {
      await broadcast(admin, {
        title: '⏰ Kicking off soon',
        body: `${m.home_team} vs ${m.away_team} starts in ${Math.max(1, Math.round(minsToKickoff))} min — lock in your pick!`,
        url: '/matches',
        tag,
      });
      patch.notif_pre = true;
      sent.push(`pre ${m.id}`);
    }

    if (Object.keys(patch).length) await admin.from('matches').update(patch).eq('id', m.id);
  }

  return NextResponse.json({ ok: true, sent });
}
