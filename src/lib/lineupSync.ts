import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchWcFixtures, fetchLineups } from './apiFootball';
import { lookup } from './ml/teams';

// Lineups publish 20-40 min before kickoff and never change once posted, so we
// poll the pre-kickoff window and stop forever at the first non-empty hit. The
// free tier is 100 req/day and a heavy day is ~6 games, so we can afford to start
// early and poll often; MAX_ATTEMPTS bounds the worst case (a never-posted match).
const OPEN_BEFORE_MS = 60 * 60_000; // start polling 60 min before kickoff
const LATE_AFTER_MS = 30 * 60_000; // give up 30 min after kickoff if never posted
const RECHECK_MS = 5 * 60_000; // min gap between polls for one match
const MAX_ATTEMPTS = 8; // hard cap on polls per match (worst case ~8 x 6 games/day)
const MAX_CALLS = 12; // hard cap on lineup calls per single run

interface Row {
  id: number;
  home_team: string;
  away_team: string;
  home_code: string | null;
  away_code: string | null;
  kickoff: string;
  af_fixture_id: number | null;
  lineups: unknown | null;
  lineup_checked_at: string | null;
  lineup_attempts: number | null;
}

const codeOf = (name: string): string | null => lookup(name)?.code ?? null;

/**
 * Fetch confirmed lineups from API-Football for matches in the pre-kickoff
 * window, frugally: one fixture-id mapping call when needed, then at most one
 * lineups call per match per ~12 min until found. Best-effort; never throws.
 */
export async function runLineupSync(admin: SupabaseClient): Promise<string[]> {
  const done: string[] = [];
  try {
    const key = process.env.APIFOOTBALL_KEY;
    if (!key) return done;

    const now = Date.now();
    const from = new Date(now - LATE_AFTER_MS).toISOString();
    const to = new Date(now + OPEN_BEFORE_MS).toISOString();

    const { data } = await admin
      .from('matches')
      .select('id,home_team,away_team,home_code,away_code,kickoff,af_fixture_id,lineups,lineup_checked_at,lineup_attempts')
      .gte('kickoff', from)
      .lte('kickoff', to)
      .is('lineups', null);

    const rows = (data as Row[] | null) ?? [];
    // Only matches with both teams known, under the attempt cap, and due for a recheck.
    const due = rows.filter(
      (m) =>
        m.home_code &&
        m.away_code &&
        (m.lineup_attempts ?? 0) < MAX_ATTEMPTS &&
        (!m.lineup_checked_at || now - Date.parse(m.lineup_checked_at) >= RECHECK_MS)
    );
    if (due.length === 0) return done;

    // Map our football-data rows to API-Football fixture ids (one call, reused).
    if (due.some((m) => !m.af_fixture_id)) {
      try {
        const fixtures = await fetchWcFixtures(key);
        const byKey = new Map<string, number>();
        for (const f of fixtures) {
          const hc = codeOf(f.home);
          const ac = codeOf(f.away);
          if (hc && ac) byKey.set(`${hc}|${ac}|${f.date.slice(0, 10)}`, f.id);
        }
        for (const m of due) {
          if (m.af_fixture_id) continue;
          const id = byKey.get(`${m.home_code}|${m.away_code}|${m.kickoff.slice(0, 10)}`);
          if (id) {
            m.af_fixture_id = id;
            await admin.from('matches').update({ af_fixture_id: id }).eq('id', m.id);
          }
        }
      } catch {
        /* mapping failed; try again next run */
      }
    }

    let calls = 0;
    for (const m of due) {
      if (calls >= MAX_CALLS) break;
      if (!m.af_fixture_id) continue;
      calls++;
      const checkedAt = new Date().toISOString();
      const attempts = (m.lineup_attempts ?? 0) + 1;
      try {
        const lineups = await fetchLineups(m.af_fixture_id, key, codeOf, m.home_code!, m.away_code!);
        if (lineups) {
          await admin.from('matches').update({ lineups, lineup_checked_at: checkedAt, lineup_attempts: attempts }).eq('id', m.id);
          done.push(`lineup ${m.id}`);
        } else {
          await admin.from('matches').update({ lineup_checked_at: checkedAt, lineup_attempts: attempts }).eq('id', m.id);
        }
      } catch {
        await admin.from('matches').update({ lineup_checked_at: checkedAt, lineup_attempts: attempts }).eq('id', m.id);
      }
    }
  } catch {
    /* best-effort: lineups must never break the sync */
  }
  return done;
}
