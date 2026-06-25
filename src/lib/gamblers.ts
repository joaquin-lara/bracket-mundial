// Server-side settlement for the Gamblers fake-money side game (see
// supabase/gamblers.sql and supabase/gambler-markets.sql). Bets/parlays are
// placed (and debited) immediately via their RPCs; this only ever resolves
// "pending" rows against finished matches and credits winners. Idempotent: a
// row's status flips from pending to won/lost exactly once, so re-running
// finds nothing left to do for matches it already settled.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { GamblerComparator, GamblerMarket, GamblerSide, MatchStats, TeamMatchStats } from './types';

const THROTTLE_MS = 60_000; // re-check at most once a minute
let lastRun = 0;
let inFlight: Promise<void> | null = null;

/** Single-flight + throttled. Never throws: a failure must not break a page. */
export function ensureGamblerSettlement(admin: SupabaseClient): Promise<void> {
  if (inFlight) return inFlight;
  if (Date.now() - lastRun < THROTTLE_MS) return Promise.resolve();
  inFlight = runSettlement(admin)
    .catch((err) => console.error('gambler settlement failed:', err instanceof Error ? err.message : err))
    .finally(() => {
      lastRun = Date.now();
      inFlight = null;
    });
  return inFlight;
}

interface MatchResult {
  home_score: number;
  away_score: number;
  stats: MatchStats | null;
}
type ResultById = Map<number, MatchResult>;

async function fetchFinishedResults(admin: SupabaseClient): Promise<ResultById> {
  const { data, error } = await admin
    .from('matches')
    .select('id, home_score, away_score, match_stats')
    .eq('status', 'FINISHED')
    .not('home_score', 'is', null)
    .not('away_score', 'is', null);
  if (error) throw error;
  return new Map(
    (data ?? []).map((m) => [
      m.id as number,
      { home_score: m.home_score as number, away_score: m.away_score as number, stats: (m.match_stats as MatchStats) ?? null },
    ])
  );
}

function resultLabel(home: number, away: number): 'home' | 'draw' | 'away' {
  if (home > away) return 'home';
  if (home < away) return 'away';
  return 'draw';
}

// market -> which TeamMatchStats field it reads.
const STAT_FIELD_BY_MARKET: Partial<Record<GamblerMarket, keyof TeamMatchStats>> = {
  corners: 'cornerKicks',
  shots_on_goal: 'shotsOnGoal',
  shots_off_goal: 'shotsOffGoal',
  total_shots: 'totalShots',
  blocked_shots: 'blockedShots',
  shots_inside_box: 'shotsInsideBox',
  shots_outside_box: 'shotsOutsideBox',
  fouls: 'fouls',
  yellow_cards: 'yellowCards',
  red_cards: 'redCards',
  possession: 'possession',
};

/** The stat value a leg's market+side resolves to, or null if missing from the payload. */
function statValue(market: GamblerMarket, side: GamblerSide, stats: MatchStats): number | null {
  const field = STAT_FIELD_BY_MARKET[market];
  if (!field) return null;
  if (side === 'home') return stats.home[field];
  if (side === 'away') return stats.away[field];
  const h = stats.home[field];
  const a = stats.away[field];
  return h != null && a != null ? h + a : null;
}

export interface LegLike {
  match_id: number;
  market: GamblerMarket;
  side: GamblerSide | null;
  comparator: GamblerComparator | null;
  line: number | null;
  pick: 'home' | 'draw' | 'away' | null;
  pick_home_score: number | null;
  pick_away_score: number | null;
}

/** Whether `result` carries everything needed to resolve this leg yet. */
export function legResolvable(leg: LegLike, result: MatchResult | undefined): boolean {
  if (!result) return false;
  if (leg.market === 'winner' || leg.market === 'exact_score') return true;
  return result.stats != null; // stat markets wait for match_stats, not just FINISHED
}

/** Whether this leg won, given a resolvable result (call legResolvable first). */
export function legWon(leg: LegLike, result: MatchResult): boolean {
  if (leg.market === 'winner') {
    return resultLabel(result.home_score, result.away_score) === leg.pick;
  }
  if (leg.market === 'exact_score') {
    return leg.pick_home_score === result.home_score && leg.pick_away_score === result.away_score;
  }
  const value = statValue(leg.market, leg.side!, result.stats!);
  if (value == null) return false; // field missing in the payload -- never crash settlement
  return leg.comparator === 'over' ? value > leg.line! : value < leg.line!;
}

async function runSettlement(admin: SupabaseClient): Promise<void> {
  const results = await fetchFinishedResults(admin);
  if (results.size === 0) return;
  await settleGamblerBets(admin, results);
  await settleGamblerParlays(admin, results);
}

interface PendingBet extends LegLike {
  id: string;
  user_id: string;
  amount: number;
  payout_multiplier: number;
}

export async function settleGamblerBets(admin: SupabaseClient, results: ResultById): Promise<{ settled: number }> {
  const { data: pending, error } = await admin
    .from('gambler_bets_v2')
    .select('id, user_id, match_id, market, side, comparator, line, pick, pick_home_score, pick_away_score, amount, payout_multiplier')
    .eq('status', 'pending')
    .in('match_id', [...results.keys()]);
  if (error) throw error;
  const bets = (pending ?? []) as PendingBet[];

  let settled = 0;
  for (const bet of bets) {
    const result = results.get(bet.match_id);
    if (!legResolvable(bet, result)) continue;

    const won = legWon(bet, result!);
    const payout = won ? bet.amount * bet.payout_multiplier : 0;

    await admin
      .from('gambler_bets_v2')
      .update({ status: won ? 'won' : 'lost', payout, settled_at: new Date().toISOString() })
      .eq('id', bet.id);

    if (won) {
      await admin.rpc('gambler_credit', { p_user: bet.user_id, p_amount: payout });
    }
    settled++;
  }

  return { settled };
}

interface PendingTicket {
  id: string;
  user_id: string;
  amount: number;
  payout_multiplier: number;
}
interface PendingLeg extends LegLike {
  id: string;
  ticket_id: string;
}

/**
 * Parlays can span several matches (and mixed markets), so unlike
 * standalone bets they can't be fetched with one `.in(match_id, ...)` --
 * pull every pending ticket (low volume for a friends app) and settle only
 * the ones where EVERY leg is resolvable; the rest stay pending until their
 * remaining matches/stats are in.
 */
export async function settleGamblerParlays(admin: SupabaseClient, results: ResultById): Promise<{ settled: number }> {
  const { data: tickets, error: ticketErr } = await admin
    .from('gambler_parlay_tickets')
    .select('id, user_id, amount, payout_multiplier')
    .eq('status', 'pending');
  if (ticketErr) throw ticketErr;
  const pendingTickets = (tickets ?? []) as PendingTicket[];
  if (pendingTickets.length === 0) return { settled: 0 };

  const { data: legs, error: legErr } = await admin
    .from('gambler_parlay_legs')
    .select('id, ticket_id, match_id, market, side, comparator, line, pick, pick_home_score, pick_away_score, status')
    .in('ticket_id', pendingTickets.map((t) => t.id))
    .eq('status', 'pending');
  if (legErr) throw legErr;
  const legsByTicket = new Map<string, PendingLeg[]>();
  for (const leg of (legs ?? []) as PendingLeg[]) {
    const arr = legsByTicket.get(leg.ticket_id) ?? [];
    arr.push(leg);
    legsByTicket.set(leg.ticket_id, arr);
  }

  let settled = 0;
  for (const ticket of pendingTickets) {
    const ticketLegs = legsByTicket.get(ticket.id) ?? [];
    const resultByLeg = ticketLegs.map((leg) => ({ leg, result: results.get(leg.match_id) }));
    if (resultByLeg.some(({ leg, result }) => !legResolvable(leg, result))) continue; // a leg's match/stats still pending

    let allWon = true;
    for (const { leg, result } of resultByLeg) {
      const won = legWon(leg, result!);
      await admin
        .from('gambler_parlay_legs')
        .update({ status: won ? 'won' : 'lost' })
        .eq('id', leg.id);
      if (!won) allWon = false;
    }

    const payout = allWon ? ticket.amount * ticket.payout_multiplier : 0;
    await admin
      .from('gambler_parlay_tickets')
      .update({ status: allWon ? 'won' : 'lost', payout, settled_at: new Date().toISOString() })
      .eq('id', ticket.id);

    if (allWon) {
      await admin.rpc('gambler_credit', { p_user: ticket.user_id, p_amount: payout });
    }
    settled++;
  }

  return { settled };
}
