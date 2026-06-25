import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchStatistics } from './apiFootball';
import { lookup } from './ml/teams';

// API-Football statistics, fetched once a match is FINISHED. Unlike lineups,
// this never needs the live `?live=all` feed -- it reads a fixture by id
// (af_fixture_id, captured earlier while the match was live by lineupSync),
// so it costs exactly one call per finished match, ever.
const MAX_ATTEMPTS = 12; // cap retries on transient API failures
const MAX_CALLS = 8; // hard cap on stats calls per single run
const RECHECK_MS = 10 * 60_000; // min gap between retries for one match

interface Row {
  id: number;
  home_code: string | null;
  away_code: string | null;
  af_fixture_id: number | null;
  match_stats: unknown | null;
  match_stats_checked_at: string | null;
  match_stats_attempts: number | null;
}

const codeOf = (name: string): string | null => lookup(name)?.code ?? null;

/**
 * Final statistics (corners, shots, cards, possession, fouls...) for matches
 * that have finished and have a known API-Football fixture id, but no stats
 * yet. Best-effort; never throws. No API calls when nothing is due.
 */
export async function runStatsSync(admin: SupabaseClient): Promise<string[]> {
  const done: string[] = [];
  try {
    const key = process.env.APIFOOTBALL_KEY;
    if (!key) return done;

    const now = Date.now();

    const { data } = await admin
      .from('matches')
      .select('id,home_code,away_code,af_fixture_id,match_stats,match_stats_checked_at,match_stats_attempts')
      .eq('status', 'FINISHED')
      .not('af_fixture_id', 'is', null)
      .is('match_stats', null);

    const rows = (data as Row[] | null) ?? [];
    const due = rows.filter(
      (m) =>
        m.home_code &&
        m.away_code &&
        (m.match_stats_attempts ?? 0) < MAX_ATTEMPTS &&
        (!m.match_stats_checked_at || now - Date.parse(m.match_stats_checked_at) >= RECHECK_MS)
    );

    let calls = 0;
    for (const m of due) {
      if (calls >= MAX_CALLS) break;
      calls++;
      const checkedAt = new Date().toISOString();
      const attempts = (m.match_stats_attempts ?? 0) + 1;
      try {
        const stats = await fetchStatistics(m.af_fixture_id!, key, codeOf, m.home_code!, m.away_code!);
        if (stats) {
          await admin
            .from('matches')
            .update({ match_stats: stats, match_stats_checked_at: checkedAt, match_stats_attempts: attempts })
            .eq('id', m.id);
          done.push(`stats ${m.id}`);
        } else {
          await admin
            .from('matches')
            .update({ match_stats_checked_at: checkedAt, match_stats_attempts: attempts })
            .eq('id', m.id);
        }
      } catch {
        await admin
          .from('matches')
          .update({ match_stats_checked_at: checkedAt, match_stats_attempts: attempts })
          .eq('id', m.id);
      }
    }
  } catch {
    /* best-effort: stats must never break the sync */
  }
  return done;
}
