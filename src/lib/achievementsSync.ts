// Server-side achievement evaluation + persistence. Loads the data the pure
// evaluator needs (via the service-role key, bypassing RLS), runs it, and
// writes any newly-earned badges into user_achievements — idempotently, so a
// badge is awarded once and never re-awarded.
//
// Reveal logic (see achievements.sql): the first run silently backfills what
// players have ALREADY earned (baseline = true, no banner). The first badge
// earned after that (baseline = false) flips achievements_state.revealed_at
// and is announced group-wide.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  evaluate,
  type DuelInfo,
  type DuelRound,
  type EvalContext,
  type MatchInfo,
  type PredInfo,
} from './achievements';
import { GUEST_NAME } from './players';
import { ACHIEVEMENTS_BY_ID } from './achievementsList';
import { sendToUser } from './push/webpush';

const THROTTLE_MS = 60_000; // re-evaluate at most once a minute
let lastRun = 0;
let inFlight: Promise<void> | null = null;

/** Single-flight + throttled. Never throws: a failure must not break a page. */
export function ensureAchievements(): Promise<void> {
  if (inFlight) return inFlight;
  if (Date.now() - lastRun < THROTTLE_MS) return Promise.resolve();
  inFlight = runAchievements()
    .catch((err) => console.error('achievements sync failed:', err instanceof Error ? err.message : err))
    .finally(() => {
      lastRun = Date.now();
      inFlight = null;
    });
  return inFlight;
}

async function runAchievements(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const ctx = await loadContext(admin);
  if (ctx.players.length === 0) return;

  const earnedByPlayer = evaluate(ctx);

  // Currently-earned, flattened (with the match that triggered each, if any).
  const earned: { userId: string; achievementId: string; matchId: number | null }[] = [];
  for (const [userId, idMap] of earnedByPlayer) {
    for (const [id, matchId] of idMap) earned.push({ userId, achievementId: id, matchId });
  }

  // What's already recorded (and which of those still lack match context).
  const { data: existingRows } = await admin
    .from('user_achievements')
    .select('user_id, achievement_id, match_id');
  const have = new Set((existingRows ?? []).map((r) => `${r.user_id}|${r.achievement_id}`));
  const needsContext = new Set(
    (existingRows ?? [])
      .filter((r) => r.match_id == null)
      .map((r) => `${r.user_id}|${r.achievement_id}`)
  );
  const fresh = earned.filter((e) => !have.has(`${e.userId}|${e.achievementId}`));

  // Reconcile: drop any recorded badge the evaluator no longer reports. Earned
  // is otherwise monotonic (finished-match data only grows), so this only
  // removes rows mistakenly written before a rule fix — e.g. participation
  // badges awarded off pre-filled future picks. Self-healing.
  // Guard: only prune when fixtures actually loaded, so a transient empty
  // read can never wipe legitimately-earned badges.
  if (ctx.matches.length > 0) {
    const earnedKeys = new Set(earned.map((e) => `${e.userId}|${e.achievementId}`));
    const stale = (existingRows ?? []).filter(
      (r) => !earnedKeys.has(`${r.user_id}|${r.achievement_id}`)
    );
    for (const r of stale) {
      await admin
        .from('user_achievements')
        .delete()
        .eq('user_id', r.user_id as string)
        .eq('achievement_id', r.achievement_id as string);
    }
  }

  // Feature state.
  const { data: stateRow } = await admin
    .from('achievements_state')
    .select('baseline_at, revealed_at')
    .eq('id', 1)
    .maybeSingle();
  const baselineDone = !!stateRow?.baseline_at;
  const alreadyRevealed = !!stateRow?.revealed_at;

  if (!baselineDone) {
    // First ever run: silent backfill. Everything earned so far is "baseline".
    if (fresh.length > 0) {
      await admin.from('user_achievements').upsert(
        fresh.map((e) => ({
          user_id: e.userId,
          achievement_id: e.achievementId,
          baseline: true,
          match_id: e.matchId,
        })),
        { onConflict: 'user_id,achievement_id', ignoreDuplicates: true }
      );
    }
    await admin.from('achievements_state').update({ baseline_at: new Date().toISOString() }).eq('id', 1);
  } else if (fresh.length > 0) {
    // Live unlocks.
    await admin.from('user_achievements').upsert(
      fresh.map((e) => ({
        user_id: e.userId,
        achievement_id: e.achievementId,
        baseline: false,
        match_id: e.matchId,
      })),
      { onConflict: 'user_id,achievement_id', ignoreDuplicates: true }
    );

    // Push each earner their new badge(s). Best-effort; never blocks the sync.
    for (const e of fresh) {
      const def = ACHIEVEMENTS_BY_ID[e.achievementId];
      if (!def) continue;
      try {
        await sendToUser(admin, e.userId, {
          title: `${def.emoji} Achievement unlocked!`,
          body: `${def.name} — ${def.description}`,
          url: '/achievements',
          tag: `ach-${e.achievementId}`,
        });
      } catch {
        /* ignore push failures */
      }
    }

    // First live unlock ever → fire the group reveal.
    if (!alreadyRevealed) {
      const first = fresh[0];
      await admin
        .from('achievements_state')
        .update({
          revealed_at: new Date().toISOString(),
          first_user: first.userId,
          first_achievement: first.achievementId,
        })
        .eq('id', 1);
    }
  }

  // Backfill the triggering match onto existing rows that predate match_id
  // (e.g. the silent baseline written before this column existed). Only the
  // rows that still lack it are touched, so this stops once everything's filled.
  for (const e of earned) {
    if (e.matchId == null || !needsContext.has(`${e.userId}|${e.achievementId}`)) continue;
    await admin
      .from('user_achievements')
      .update({ match_id: e.matchId })
      .eq('user_id', e.userId)
      .eq('achievement_id', e.achievementId);
  }
}

async function loadContext(admin: SupabaseClient): Promise<EvalContext> {
  const [profilesRes, matchesRes, predsRes, duelsRes, standingsRes] = await Promise.all([
    admin.from('profiles').select('id, display_name'),
    admin
      .from('matches')
      .select('id, stage, group_name, venue, kickoff, status, home_score, away_score, home_code, away_code'),
    admin.from('predictions').select('user_id, match_id, pred_home, pred_away, points, updated_at'),
    admin
      .from('duels')
      .select('id, challenger, opponent, status, winner, challenger_score, opponent_score, rounds, updated_at')
      .eq('status', 'finished'),
    admin.from('standings').select('user_id, total'),
  ]);

  const players = (profilesRes.data ?? [])
    .filter((p) => p.display_name !== GUEST_NAME)
    .map((p) => p.id as string);

  const matches: MatchInfo[] = (matchesRes.data ?? []).map((m) => ({
    id: m.id as number,
    stage: (m.stage as string) ?? 'GROUP_STAGE',
    groupName: (m.group_name as string | null) ?? null,
    venue: (m.venue as string | null) ?? null,
    kickoff: m.kickoff as string,
    status: (m.status as string) ?? 'SCHEDULED',
    homeScore: (m.home_score as number | null) ?? null,
    awayScore: (m.away_score as number | null) ?? null,
    homeCode: (m.home_code as string | null) ?? null,
    awayCode: (m.away_code as string | null) ?? null,
  }));

  const predictions: PredInfo[] = (predsRes.data ?? []).map((p) => ({
    userId: p.user_id as string,
    matchId: p.match_id as number,
    predHome: p.pred_home as number,
    predAway: p.pred_away as number,
    points: (p.points as number | null) ?? null,
    updatedAt: p.updated_at as string,
  }));

  const duels: DuelInfo[] = (duelsRes.data ?? []).map((d) => ({
    id: d.id as string,
    challenger: d.challenger as string,
    opponent: d.opponent as string,
    status: d.status as string,
    winner: (d.winner as string | null) ?? null,
    challengerScore: (d.challenger_score as number) ?? 0,
    opponentScore: (d.opponent_score as number) ?? 0,
    rounds: ((d.rounds as DuelRound[] | null) ?? []) as DuelRound[],
    finishedAt: d.updated_at as string,
  }));

  const playerSet = new Set(players);
  const standings = (standingsRes.data ?? [])
    .map((s) => ({ userId: s.user_id as string, total: (s.total as number) ?? 0 }))
    .filter((s) => playerSet.has(s.userId)); // exclude the view-only guest

  const tournamentComplete = matches.some((m) => m.stage === 'FINAL' && m.status === 'FINISHED');

  return { players, matches, predictions, duels, standings, tournamentComplete };
}
