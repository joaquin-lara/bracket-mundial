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
 * Atomically claim a notification: flip the matches row from `where` to `set`,
 * succeeding only if the row still matched `where`. Returns true for the single
 * caller that won the race, false for everyone else. This is what guarantees a
 * notification fires exactly once even when several sync runs overlap (the
 * kickoff alert now runs every minute, so overlap is routine).
 */
async function claim(
  admin: SupabaseClient,
  id: string,
  where: Record<string, unknown>,
  set: Record<string, unknown>
): Promise<boolean> {
  let q = admin.from('matches').update(set).eq('id', id);
  for (const [k, v] of Object.entries(where)) q = q.eq(k, v);
  const { data } = await q.select('id');
  return !!data && data.length > 0;
}

/**
 * Send any due push notifications for matches around now: a reminder before
 * kickoff, a kickoff alert exactly on the clock, and a live goal alert per goal.
 * Each fires at most once — claimed atomically on the matches row, so the
 * every-minute cadence (and overlapping full syncs) can never double-send.
 * Reads only the database (no football API), so it is cheap to run often.
 * Best-effort: never throws.
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

      if (!m.notif_pre && minsToKickoff > 0 && minsToKickoff <= PRE_MIN) {
        if (await claim(admin, m.id, { notif_pre: false }, { notif_pre: true })) {
          await broadcast(admin, {
            title: '⏰ Kicking off soon',
            body: `${m.home_team} vs ${m.away_team} starts in ${Math.max(1, Math.round(minsToKickoff))} min — lock in your pick!`,
            url: '/matches',
            tag,
          });
          sent.push(`pre ${m.id}`);
        }
      }

      if (!m.notif_start && now >= kickoff) {
        // Kickoff: claim first (baselining the score so a goal that happened
        // before we started watching is never announced), then alert. Only the
        // winning caller broadcasts, so it fires exactly once.
        if (
          await claim(
            admin,
            m.id,
            { notif_start: false },
            { notif_start: true, notif_home_score: hs, notif_away_score: as }
          )
        ) {
          await broadcast(admin, {
            title: '🟢 Kickoff!',
            body: `${m.home_team} vs ${m.away_team} is underway.`,
            url: '/matches',
            tag,
          });
          sent.push(`start ${m.id}`);
        }
      } else if (m.notif_start && hs + as > m.notif_home_score + m.notif_away_score) {
        // Goal: claim by advancing the baseline from the score we read, so a
        // concurrent run that already announced this goal makes us a no-op.
        if (
          await claim(
            admin,
            m.id,
            { notif_home_score: m.notif_home_score, notif_away_score: m.notif_away_score },
            { notif_home_score: hs, notif_away_score: as }
          )
        ) {
          const scorer = hs > m.notif_home_score ? m.home_team : m.away_team;
          await broadcast(admin, {
            title: `⚽ GOAL — ${scorer}!`,
            body: `${m.home_team} ${hs}–${as} ${m.away_team}`,
            url: '/matches',
            tag,
          });
          sent.push(`goal ${m.id}`);
        }
      }
    }
  } catch {
    /* best-effort: notifications must never break the sync */
  }
  return sent;
}
