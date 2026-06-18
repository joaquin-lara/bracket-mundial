import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchWcFixtures, fetchLineups } from './apiFootball';
import { lookup } from './ml/teams';

// API-Football's free tier only serves LIVE fixtures (`?live=all`) — season and
// date queries return nothing for the current season. So a lineup can only be
// fetched once its match is in progress, and finished matches that we never
// caught live are unrecoverable. We therefore poll only matches that have kicked
// off and aren't finished, and stop forever at the first non-empty hit (lineups
// never change once posted). When nothing is live, this makes ZERO API calls.
const LIVE_BACK_MS = 3 * 60 * 60_000; // a match is "live" up to ~3h after kickoff
// Keep the recheck gap just under the 5-min cron interval, or clock jitter makes
// a tick land at 4:58 and get skipped -- effectively halving the poll rate.
const RECHECK_MS = 4 * 60_000; // min gap between polls for one match
const MAX_ATTEMPTS = 24; // cap polls per match (~2h of a live game) then give up
const MAX_CALLS = 8; // hard cap on lineup calls per single run

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
 * Fetch confirmed lineups from API-Football for matches that are currently live,
 * frugally: one `?live=all` mapping call when needed, then one lineups call per
 * live match until found. Best-effort; never throws. No API calls when nothing
 * is live.
 */
export async function runLineupSync(admin: SupabaseClient): Promise<string[]> {
  const done: string[] = [];
  try {
    const key = process.env.APIFOOTBALL_KEY;
    if (!key) return done;

    const now = Date.now();
    const from = new Date(now - LIVE_BACK_MS).toISOString();
    const nowIso = new Date(now).toISOString();

    // Kicked off, not finished, no lineup yet = a live game we can still fetch.
    const { data } = await admin
      .from('matches')
      .select('id,home_team,away_team,home_code,away_code,kickoff,af_fixture_id,lineups,lineup_checked_at,lineup_attempts')
      .gte('kickoff', from)
      .lte('kickoff', nowIso)
      .neq('status', 'FINISHED')
      .is('lineups', null);

    const rows = (data as Row[] | null) ?? [];
    const due = rows.filter(
      (m) =>
        m.home_code &&
        m.away_code &&
        (m.lineup_attempts ?? 0) < MAX_ATTEMPTS &&
        (!m.lineup_checked_at || now - Date.parse(m.lineup_checked_at) >= RECHECK_MS)
    );
    if (due.length === 0) return done; // nothing live -> no API calls

    // Map our football-data rows to API-Football fixture ids via the live feed
    // (one call, shared across every live match this run).
    if (due.some((m) => !m.af_fixture_id)) {
      try {
        const fixtures = await fetchWcFixtures(key);
        const byPair = new Map<string, { id: number; t: number }[]>();
        for (const f of fixtures) {
          const a = codeOf(f.home);
          const b = codeOf(f.away);
          if (!a || !b) continue;
          const key2 = [a, b].sort().join('|');
          const arr = byPair.get(key2) ?? [];
          arr.push({ id: f.id, t: Date.parse(f.date) });
          byPair.set(key2, arr);
        }
        for (const m of due) {
          if (m.af_fixture_id) continue;
          const cands = byPair.get([m.home_code!, m.away_code!].sort().join('|'));
          if (!cands?.length) continue;
          const kt = Date.parse(m.kickoff);
          const best = cands.reduce((p, c) => (Math.abs(c.t - kt) < Math.abs(p.t - kt) ? c : p));
          if (Math.abs(best.t - kt) > 2 * 24 * 60 * 60_000) continue;
          m.af_fixture_id = best.id;
          await admin.from('matches').update({ af_fixture_id: best.id }).eq('id', m.id);
        }
      } catch {
        /* mapping failed; try again next run */
      }
    }

    let calls = 0;
    for (const m of due) {
      if (calls >= MAX_CALLS) break;
      const checkedAt = new Date().toISOString();
      const attempts = (m.lineup_attempts ?? 0) + 1;
      // Throttle even unmapped matches so we don't re-call the live feed every run.
      if (!m.af_fixture_id) {
        await admin.from('matches').update({ lineup_checked_at: checkedAt, lineup_attempts: attempts }).eq('id', m.id);
        continue;
      }
      calls++;
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
