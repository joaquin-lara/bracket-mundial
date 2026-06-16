import type { SupabaseClient } from '@supabase/supabase-js';
import { broadcast } from './webpush';

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

const PRE_MIN = 20; // minutes before kickoff for the reminder

/**
 * Send any due push notifications for matches around now: a reminder ~10 min
 * before kickoff, a kickoff alert, and a live goal alert per goal. Each fires at
 * most once, de-duplicated by flags on the matches row. Call this right after the
 * fixture/score sync so it sees fresh scores. Best-effort: never throws.
 */
export async function runMatchNotifications(admin: SupabaseClient): Promise<string[]> {
  const sent: string[] = [];
  try {
    const now = Date.now();
    const from = new Date(now - 3 * 60 * 60 * 1000).toISOString();
    const to = new Date(now + 25 * 60 * 1000).toISOString(); // covers the 20-min reminder
    const { data: matches } = await admin
      .from('matches')
      .select('id,home_team,away_team,kickoff,status,home_score,away_score,notif_pre,notif_start,notif_home_score,notif_away_score')
      .gte('kickoff', from)
      .lte('kickoff', to);

    for (const m of (matches as MatchRow[]) ?? []) {
      const kickoff = Date.parse(m.kickoff);
      const minsToKickoff = (kickoff - now) / 60000;
      const hs = m.home_score ?? 0;
      const as = m.away_score ?? 0;
      const tag = `match-${m.id}`;
      const patch: Record<string, unknown> = {};

      if (!m.notif_start && now >= kickoff) {
        // Kickoff: alert, and baseline the score so a goal that happened before
        // we started watching (e.g. a missed earlier run) is never announced.
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
  } catch {
    /* best-effort: notifications must never break the sync */
  }
  return sent;
}
