// Achievements: the pure evaluator. The static definitions live in
// achievementsList.ts (dependency-free, client-safe); this file adds the
// server-side evaluator that turns predictions/matches/duels/standings into,
// per player, the set of achievement ids they satisfy. No I/O here. Same
// pure, unit-testable shape as scoring.ts.
//
// Scoring key (see the plan): every locked pick earns >= 1 point.
//   3 = exact   2 = right outcome   1 = miss (locked, wrong)   0 = no pick.
// So "correct outcome" means points >= 2, and "got it wrong" means <= 1.

import { predict } from './ml/model';
import { ACHIEVEMENTS, ACHIEVEMENTS_BY_ID, TIER_ORDER } from './achievementsList';

export type { Tier, Category, AchievementDef } from './achievementsList';
export { ACHIEVEMENTS, ACHIEVEMENTS_BY_ID, TIER_ORDER };

// ---------------------------------------------------------------------------
// Evaluator input
// ---------------------------------------------------------------------------

export interface MatchInfo {
  id: number;
  stage: string;
  groupName: string | null;
  venue: string | null;
  kickoff: string;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  homeCode: string | null;
  awayCode: string | null;
}

export interface PredInfo {
  userId: string;
  matchId: number;
  predHome: number;
  predAway: number;
  points: number | null; // 1/2/3 or null (unscored)
  updatedAt: string;
}

export interface DuelRound {
  kick: number;
  shooter: string;
  shot: string;
  dive: string;
  goal: boolean;
}

export interface DuelInfo {
  id: string;
  challenger: string;
  opponent: string;
  status: string;
  winner: string | null;
  challengerScore: number;
  opponentScore: number;
  rounds: DuelRound[];
  finishedAt: string;
}

export interface EvalContext {
  players: string[]; // the competitors' user ids (exclude guest)
  matches: MatchInfo[];
  predictions: PredInfo[];
  duels: DuelInfo[];
  standings: { userId: string; total: number }[];
  tournamentComplete: boolean;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const sign = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0);
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA');
const isKnockout = (stage: string) => stage !== 'GROUP_STAGE';
const LOCK_MS = 10 * 60 * 1000;

/** Model favorite + most-likely score for a match, or null if teams unknown. */
function modelFor(m: MatchInfo): {
  probHome: number;
  probAway: number;
  favIsHome: boolean;
  favProb: number;
  topHome: number;
  topAway: number;
} | null {
  const home = m.homeCode;
  const away = m.awayCode;
  if (!home || !away) return null;
  let r: ReturnType<typeof predict> = null;
  try {
    r = predict({ home, away, neutral: true });
  } catch {
    return null;
  }
  if (!r) return null;
  return {
    probHome: r.probHome,
    probAway: r.probAway,
    favIsHome: r.probHome >= r.probAway,
    favProb: Math.max(r.probHome, r.probAway),
    topHome: r.mostLikelyScore.home,
    topAway: r.mostLikelyScore.away,
  };
}

/** Longest run of consecutive entries satisfying `ok`. */
function longestRun<T>(arr: T[], ok: (t: T) => boolean): number {
  let best = 0;
  let cur = 0;
  for (const t of arr) {
    if (ok(t)) {
      cur += 1;
      best = Math.max(best, cur);
    } else {
      cur = 0;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// The evaluator
// ---------------------------------------------------------------------------

/**
 * Returns, for each player id, a map of earned achievement id -> the match id
 * that triggered it (or null for cumulative/duel/placement badges).
 */
export function evaluate(ctx: EvalContext): Map<string, Map<string, number | null>> {
  const matchById = new Map(ctx.matches.map((m) => [m.id, m]));

  // Per-match: every player's points (for Mic Drop).
  const pointsByMatch = new Map<number, Map<string, number>>();
  for (const p of ctx.predictions) {
    if (p.points == null) continue;
    let mm = pointsByMatch.get(p.matchId);
    if (!mm) {
      mm = new Map();
      pointsByMatch.set(p.matchId, mm);
    }
    mm.set(p.userId, p.points);
  }

  // Predictions grouped by player.
  const predsByPlayer = new Map<string, PredInfo[]>();
  for (const p of ctx.predictions) {
    const arr = predsByPlayer.get(p.userId) ?? [];
    arr.push(p);
    predsByPlayer.set(p.userId, arr);
  }

  // Schedule: matchdays (dates that have >= 1 match), counts per day.
  const matchesByDay = new Map<string, number[]>();
  for (const m of ctx.matches) {
    const d = dayOf(m.kickoff);
    const arr = matchesByDay.get(d) ?? [];
    arr.push(m.id);
    matchesByDay.set(d, arr);
  }
  const scheduleDays = [...matchesByDay.keys()].sort();
  const knockoutMatchIds = ctx.matches.filter((m) => isKnockout(m.stage)).map((m) => m.id);

  // Host venues that exist in the schedule (for Globetrotter).
  const allVenues = new Set(ctx.matches.map((m) => m.venue).filter((v): v is string => !!v));

  // userId -> (achievementId -> matchId that triggered it, or null)
  const result = new Map<string, Map<string, number | null>>();

  for (const player of ctx.players) {
    const earned = new Map<string, number | null>();
    // First add wins, so the recorded match is the one that first satisfied it.
    const add = (id: string, matchId: number | null = null) => {
      if (!earned.has(id)) earned.set(id, matchId);
    };
    const preds = predsByPlayer.get(player) ?? [];
    const scored = preds
      .filter((p) => p.points != null)
      .sort((a, b) => kickoffOf(a, matchById) - kickoffOf(b, matchById));

    // ---- counts ----
    const exactCount = scored.filter((p) => p.points === 3).length;
    const outcomeCount = scored.filter((p) => (p.points ?? 0) >= 2).length;
    const totalPoints = scored.reduce((s, p) => s + (p.points ?? 0), 0);
    // Participation only counts LOCKED picks on FINISHED matches (so pre-filling
    // future games, or picking-then-retracting, never awards anything early).
    const playedIds = new Set(scored.map((p) => p.matchId));
    const matchesPredicted = playedIds.size;

    if (exactCount >= 3) add('nostradamus');
    if (exactCount >= 8) add('nostradamus_prime');
    if (exactCount >= 15) add('sniper_elite');
    if (outcomeCount >= 20) add('marksman');
    if (outcomeCount >= 40) add('deadeye');
    if (totalPoints >= 50) add('half_century');
    if (totalPoints >= 100) add('centurion');
    if (totalPoints >= 200) add('galactico');
    if (totalPoints >= 250) add('the_goat');
    if (matchesPredicted >= 25) add('squad_player');
    if (matchesPredicted >= 50) add('veteran');
    if (matchesPredicted >= 75) add('club_legend');
    if (matchesPredicted >= 100) add('icon');

    // ---- streaks over scored picks (chronological) ----
    const seq = scored.map((p) => p.points as number);
    const outcomeStreak = longestRun(seq, (n) => n >= 2);
    if (outcomeStreak >= 5) add('hot_streak');
    if (outcomeStreak >= 10) add('on_fire');
    if (outcomeStreak >= 15) add('unstoppable');
    if (longestRun(seq, (n) => n === 1) >= 5) add('frostbite');
    if (longestRun(seq, (n) => n === 3) >= 3) add('paul_the_octopus');
    if (hasRedemption(seq)) add('redemption');

    // ---- per-matchday (scored picks grouped by local date) ----
    const byDay = new Map<string, number[]>();
    for (const p of scored) {
      const d = dayOf(matchById.get(p.matchId)?.kickoff ?? '');
      const arr = byDay.get(d) ?? [];
      arr.push(p.points as number);
      byDay.set(d, arr);
    }
    for (const pts of byDay.values()) {
      const exacts = pts.filter((n) => n === 3).length;
      if (exacts >= 2) add('daily_double');
      if (exacts >= 3) add('hat_trick_hero');
      if (pts.length >= 3 && pts.every((n) => n >= 2)) add('flawless_day');
      if (pts.length >= 6 && pts.every((n) => n >= 2)) add('spotless_slate');
      if (pts.length >= 3 && pts.every((n) => n === 1)) add('participation_trophy');
    }

    // ---- per-prediction feats (exacts on special scorelines, model, etc) ----
    let stalemateCount = 0;
    let upsetCount = 0;
    for (const p of scored) {
      const m = matchById.get(p.matchId);
      if (!m || m.homeScore == null || m.awayScore == null) continue;
      const pts = p.points as number;
      const exact = pts === 3;
      const got = pts >= 2;
      const total = m.homeScore + m.awayScore;
      const margin = Math.abs(m.homeScore - m.awayScore);
      const actualOutcome = sign(m.homeScore - m.awayScore);
      const predOutcome = sign(p.predHome - p.predAway);

      // Ambitious / High Roller (placing a 6+ bet)
      if (Math.max(p.predHome, p.predAway) >= 6) {
        add('ambitious', m.id);
        if (got) add('high_roller', m.id);
      }

      if (exact) {
        if (total >= 5) add('goal_fest', m.id);
        if (margin >= 4) add('goleada', m.id);
        if (m.homeScore === m.awayScore) add('mirror_match', m.id);
        if ((m.homeScore === 1 && m.awayScore === 0) || (m.homeScore === 0 && m.awayScore === 1)) add('smash_and_grab', m.id);
        if (m.homeScore === 0 && m.awayScore === 0) add('park_the_bus', m.id);
        if (isKnockout(m.stage)) add('clutch', m.id);
        if (m.stage === 'THIRD_PLACE') add('bronze_medal_match', m.id);
        if (m.stage === 'FINAL') add('called_the_final', m.id);
      }
      if (got && m.stage === 'FINAL') add('crowned_it', m.id);
      if (got && m.stage === 'SEMI_FINALS') add('big_stage', m.id);

      // Stalemate: correctly called a draw
      if (got && predOutcome === 0 && actualOutcome === 0) stalemateCount += 1;

      // Mic Drop: I exact, no other player got the outcome on this match
      if (exact) {
        const mm = pointsByMatch.get(p.matchId);
        const othersOk = ctx.players
          .filter((u) => u !== player)
          .every((u) => (mm?.get(u) ?? 0) <= 1);
        if (othersOk) add('mic_drop', m.id);
      }

      // Down to the Wire: locked in the final 2 minutes before close
      const lock = new Date(m.kickoff).getTime() - LOCK_MS;
      const upd = new Date(p.updatedAt).getTime();
      const delta = lock - upd;
      if (delta >= 0 && delta <= 2 * 60 * 1000) add('down_to_the_wire', m.id);

      // ---- model-based ----
      const model = modelFor(m);
      if (model) {
        const favoredSide = model.favIsHome ? 1 : -1;
        const underdogWon = actualOutcome !== 0 && actualOutcome !== favoredSide;
        const backedWinner = predOutcome === actualOutcome && actualOutcome !== 0;
        const modelTopOutcome = sign(model.topHome - model.topAway);
        const winnerProb = actualOutcome === 1 ? model.probHome : model.probAway;

        if (underdogWon && backedWinner) {
          add('giant_slayer', m.id);
          upsetCount += 1;
          if (isKnockout(m.stage)) add('bracket_buster', m.id);
          if (winnerProb < 0.2) add('miracle_on_grass', m.id);
        }
        if (got && modelTopOutcome !== actualOutcome) add('galaxy_brain', m.id);
        if (exact && p.predHome === model.topHome && p.predAway === model.topAway) add('the_analyst', m.id);
        if (got && predOutcome === 0 && actualOutcome === 0 && model.favProb > 0.6) add('banana_skin', m.id);
        if (exact && model.favProb > 0.7 && actualOutcome !== favoredSide) add('party_pooper', m.id);
        if (exact && underdogWon) add('against_all_odds', m.id);
      }
    }
    if (stalemateCount >= 3) add('stalemate');
    if (upsetCount >= 5) add('kingslayer');

    // ---- knockouts by round ----
    const knockoutScored = scored.filter((p) => isKnockout(matchById.get(p.matchId)?.stage ?? 'GROUP_STAGE'));
    const byRound = new Map<string, number[]>();
    for (const p of knockoutScored) {
      const stage = matchById.get(p.matchId)?.stage ?? '';
      const arr = byRound.get(stage) ?? [];
      arr.push(p.points as number);
      byRound.set(stage, arr);
    }
    for (const pts of byRound.values()) {
      if (pts.length >= 2 && pts.every((n) => n >= 2)) add('knockout_king');
    }
    // Dream Start: first 3 knockout picks all correct outcome
    if (knockoutScored.length >= 3 && knockoutScored.slice(0, 3).every((p) => (p.points ?? 0) >= 2)) {
      add('dream_start');
    }
    // El Hincha: a (finished) pick for every knockout match in the schedule
    if (knockoutMatchIds.length > 0) {
      if (knockoutMatchIds.every((id) => playedIds.has(id))) add('el_hincha');
    }

    // ---- The Perfect Group: outcome 2+ on all 6 games of one group ----
    const groups = new Map<string, MatchInfo[]>();
    for (const m of ctx.matches) {
      if (m.stage === 'GROUP_STAGE' && m.groupName) {
        const arr = groups.get(m.groupName) ?? [];
        arr.push(m);
        groups.set(m.groupName, arr);
      }
    }
    const myPoints = new Map(scored.map((p) => [p.matchId, p.points as number]));
    for (const gm of groups.values()) {
      if (gm.length < 6) continue;
      if (gm.every((m) => (myPoints.get(m.id) ?? 0) >= 2)) add('the_perfect_group');
    }

    // ---- Globetrotter: a (finished) pick at every host venue ----
    if (allVenues.size > 0) {
      const myVenues = new Set(
        scored.map((p) => matchById.get(p.matchId)?.venue).filter((v): v is string => !!v)
      );
      if ([...allVenues].every((v) => myVenues.has(v))) add('globetrotter');
    }

    // ---- Ever-Present / Glued / Marathon Day (schedule completeness) ----
    // A day "counts" only once all its matches are FINISHED and the player
    // had a pick on every one — pre-filling future days never qualifies.
    const dayComplete = scheduleDays.map((d) => {
      const ids = matchesByDay.get(d) ?? [];
      return ids.length > 0 && ids.every((id) => playedIds.has(id));
    });
    const completeRun = longestRun(dayComplete, (b) => b);
    if (completeRun >= 7) add('ever_present');
    if (completeRun >= 14) add('glued_to_the_screen');
    for (const d of scheduleDays) {
      const ids = matchesByDay.get(d) ?? [];
      if (ids.length >= 6 && ids.every((id) => playedIds.has(id))) add('marathon_day');
    }

    // ---- Duels ----
    evaluateDuels(player, ctx.duels, ctx.players, earned);

    result.set(player, earned);
  }

  // ---- Placement (only once the tournament is complete) ----
  if (ctx.tournamentComplete && ctx.standings.length > 0) {
    const ranked = [...ctx.standings].sort((a, b) => b.total - a.total);
    const placementIds = ['champion', 'runner_up', 'podium_finish', 'better_luck_next_time'];
    ranked.forEach((row, i) => {
      const id = placementIds[i];
      if (id) result.get(row.userId)?.set(id, null);
    });
  }

  return result;
}

function kickoffOf(p: PredInfo, matchById: Map<number, MatchInfo>): number {
  const k = matchById.get(p.matchId)?.kickoff;
  return k ? new Date(k).getTime() : 0;
}

/** A run of 5+ misses (1) immediately followed by a run of 5+ outcomes (>=2). */
function hasRedemption(seq: number[]): boolean {
  for (let i = 0; i + 10 <= seq.length; i++) {
    const before = seq.slice(i, i + 5).every((n) => n === 1);
    const after = seq.slice(i + 5, i + 10).every((n) => n >= 2);
    // require the miss-run to actually be the start (or preceded by non-1)
    const boundaryOk = i === 0 || seq[i - 1] !== 1;
    if (before && after && boundaryOk) return true;
  }
  return false;
}

function evaluateDuels(
  player: string,
  allDuels: DuelInfo[],
  players: string[],
  earned: Map<string, number | null>
): void {
  const mine = allDuels
    .filter((d) => d.status === 'finished' && (d.challenger === player || d.opponent === player))
    .sort((a, b) => new Date(a.finishedAt).getTime() - new Date(b.finishedAt).getTime());
  if (mine.length === 0) return;

  const add = (id: string) => {
    if (!earned.has(id)) earned.set(id, null);
  };
  if (mine.length >= 10) add('duelist');

  const wins = mine.filter((d) => d.winner === player);
  if (wins.length >= 1) add('first_blood');
  if (wins.length >= 5) add('shootout_king');

  // wins per opponent
  const winsVs = new Map<string, number>();
  for (const d of wins) {
    const opp = d.challenger === player ? d.opponent : d.challenger;
    winsVs.set(opp, (winsVs.get(opp) ?? 0) + 1);
  }
  if ([...winsVs.values()].some((n) => n >= 3)) add('nemesis');
  const others = players.filter((u) => u !== player);
  if (others.length === 3 && others.every((u) => (winsVs.get(u) ?? 0) >= 1)) add('rivalry_sweep');
  if (others.length === 3 && others.every((u) => (winsVs.get(u) ?? 0) >= 2)) add('apex_predator');

  // win-streak (chronological)
  const winFlags = mine.map((d) => d.winner === player);
  const winStreak = longestRun(winFlags, (b) => b);
  if (winStreak >= 3) add('on_a_roll');
  if (winStreak >= 5) add('unbeaten_run');

  // wins per day
  const winDays = new Map<string, number>();
  for (const d of wins) {
    const day = dayOf(d.finishedAt);
    winDays.set(day, (winDays.get(day) ?? 0) + 1);
  }
  if ([...winDays.values()].some((n) => n >= 2)) add('double_trouble');

  let suddenDeathWins = 0;
  for (const d of wins) {
    const oppScore = d.challenger === player ? d.opponentScore : d.challengerScore;
    const kicks = d.rounds.length;

    if (oppScore === 0) add('clean_sheet');
    if (kicks > 10) {
      add('sudden_death');
      suddenDeathWins += 1;
    }
    if (kicks >= 14) add('marathon_man');
    if (d.rounds.length > 0 && d.rounds[d.rounds.length - 1].goal === false) add('the_wall');

    // Five for Five: my first 5 kicks as shooter all scored
    const myShots = d.rounds.filter((r) => r.shooter === player).slice(0, 5);
    if (myShots.length >= 5 && myShots.every((r) => r.goal)) add('five_for_five');

    // Comeback King: was I ever down by 2+?
    let ch = 0;
    let op = 0;
    let maxDeficit = 0;
    for (const r of d.rounds) {
      if (r.goal) {
        if (r.shooter === d.challenger) ch += 1;
        else op += 1;
      }
      const mineRun = player === d.challenger ? ch : op;
      const oppRun = player === d.challenger ? op : ch;
      maxDeficit = Math.max(maxDeficit, oppRun - mineRun);
    }
    if (maxDeficit >= 2) add('comeback_king');
  }
  if (suddenDeathWins >= 2) add('sudden_death_specialist');
}
