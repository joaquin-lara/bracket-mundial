import type { Metadata } from 'next';
import './gamblers.css';
import { createClient } from '@/lib/supabase/server';
import { ensureFreshScores } from '@/lib/autoSync';
import { GUEST_NAME, PLAYER_META, PLAYERS, isGuestEmail } from '@/lib/players';
import { stageLabel, lockTime, type GamblerBet, type GamblerParlayLeg, type GamblerParlayTicket, type MarketOdds, type Match } from '@/lib/types';
import GamblersBoard, { type AllParlayEntry, type BettableMatch, type LeaderboardRow, type ParlayWithLegs } from '@/components/GamblersBoard';

export const metadata: Metadata = { title: 'Gamblers' };
export const dynamic = 'force-dynamic';

export default async function GamblersPage() {
  await ensureFreshScores();
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const guest = isGuestEmail(user.email);

  const { data: matchRows } = await supabase.from('matches').select('*').order('kickoff', { ascending: true });
  const matches = (matchRows ?? []) as Match[];

  const now = Date.now();
  const openMatches: BettableMatch[] = matches
    .filter((m) => m.home_code && m.away_code && lockTime(m.kickoff) > now)
    .slice(0, 12)
    .map((m) => ({
      id: m.id,
      homeCode: m.home_code!,
      awayCode: m.away_code!,
      homeName: m.home_team,
      awayName: m.away_team,
      stage: stageLabel(m.stage, m.group_name),
      kickoff: m.kickoff,
    }));

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, display_name, flag_code, founder_slot')
    .eq('status', 'approved');
  const approved = profiles ?? [];

  // Founders fall back to their roster flag (PLAYER_META) when their profile
  // hasn't set one explicitly -- same merge the home page's contender cards use.
  const bySlot = new Map(
    approved.filter((p) => p.founder_slot).map((p) => [p.founder_slot as string, p])
  );
  type LbCandidate = { userId: string; name: string; flagCode: string | null };
  const candidates: LbCandidate[] = PLAYERS.map((slot) => {
    const prof = bySlot.get(slot);
    return {
      userId: (prof?.id as string) ?? slot,
      name: (prof?.display_name as string) ?? slot,
      flagCode: (prof?.flag_code as string | null) ?? PLAYER_META[slot].flagCode,
    };
  });
  for (const p of approved) {
    if (p.founder_slot || p.display_name === GUEST_NAME) continue;
    candidates.push({
      userId: p.id as string,
      name: p.display_name as string,
      flagCode: (p.flag_code as string | null) ?? null,
    });
  }

  const { data: balanceRows } = await supabase.from('gambler_balances').select('user_id, balance');
  const balanceById = new Map(
    (balanceRows ?? []).map((b) => [b.user_id as string, Number(b.balance)])
  );

  const leaderboard: LeaderboardRow[] = candidates
    .map((c) => ({ ...c, balance: balanceById.get(c.userId) ?? 1000 }))
    .sort((a, b) => b.balance - a.balance);

  const { data: oddsRows } = await supabase.from('gambler_market_odds').select('market, side, line, payout_multiplier');

  const { data: myBetRows } = await supabase
    .from('gambler_bets_v2')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  const { data: myTicketRows } = await supabase
    .from('gambler_parlay_tickets')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  const myTickets = (myTicketRows ?? []) as GamblerParlayTicket[];

  const { data: myLegRows } = myTickets.length
    ? await supabase
        .from('gambler_parlay_legs')
        .select('*')
        .in('ticket_id', myTickets.map((t) => t.id))
        .order('leg_index', { ascending: true })
    : { data: [] as GamblerParlayLeg[] };
  const legsByTicket = new Map<string, GamblerParlayLeg[]>();
  for (const leg of (myLegRows ?? []) as GamblerParlayLeg[]) {
    const arr = legsByTicket.get(leg.ticket_id) ?? [];
    arr.push(leg);
    legsByTicket.set(leg.ticket_id, arr);
  }
  const myParlays: ParlayWithLegs[] = myTickets.map((t) => ({ ...t, legs: legsByTicket.get(t.id) ?? [] }));

  // Everyone's parlays (pending + settled), most recent first -- the "All
  // parlays" board is bragging-rights visibility into the whole group, not
  // just your own bets.
  const { data: allTicketRows } = await supabase
    .from('gambler_parlay_tickets')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(30);
  const allTickets = (allTicketRows ?? []) as GamblerParlayTicket[];

  const { data: allLegRows } = allTickets.length
    ? await supabase
        .from('gambler_parlay_legs')
        .select('*')
        .in('ticket_id', allTickets.map((t) => t.id))
        .order('leg_index', { ascending: true })
    : { data: [] as GamblerParlayLeg[] };
  const allLegsByTicket = new Map<string, GamblerParlayLeg[]>();
  for (const leg of (allLegRows ?? []) as GamblerParlayLeg[]) {
    const arr = allLegsByTicket.get(leg.ticket_id) ?? [];
    arr.push(leg);
    allLegsByTicket.set(leg.ticket_id, arr);
  }
  const playerById = new Map(leaderboard.map((r) => [r.userId, r]));
  const allParlays: AllParlayEntry[] = allTickets.map((t) => ({
    ...t,
    legs: allLegsByTicket.get(t.id) ?? [],
    playerName: playerById.get(t.user_id)?.name ?? 'Unknown',
    flagCode: playerById.get(t.user_id)?.flagCode ?? null,
  }));

  const matchById: Record<number, { homeName: string; awayName: string; kickoff: string }> = {};
  for (const m of matches) matchById[m.id] = { homeName: m.home_team, awayName: m.away_team, kickoff: m.kickoff };

  return (
    <main>
      <h1>Gamblers</h1>
      {guest ? (
        <p className="page-intro">
          You&apos;re browsing as a <strong>guest</strong> — you can watch the board, but placing
          bets needs a real player login.
        </p>
      ) : (
        <p className="page-intro">
          Fake money, real bragging rights. Everyone started today at <strong>$1000</strong>. Bet on
          match winners, exact scores, or stat markets like corners, shots, cards and possession —
          multipliers vary by market, shown on each card. Tap <strong>+ add another market</strong> on
          a match card to stack up to 4 picks on that game into one parlay for a bigger combined
          multiplier — miss a single pick and you lose the whole bet. Bets lock 10 minutes before
          kickoff, same as picks.
        </p>
      )}
      <GamblersBoard
        matches={openMatches}
        odds={(oddsRows ?? []) as MarketOdds[]}
        leaderboard={leaderboard}
        allParlays={allParlays}
        myBets={(myBetRows ?? []) as GamblerBet[]}
        myParlays={myParlays}
        myUserId={user.id}
        myBalance={balanceById.get(user.id) ?? 1000}
        matchById={matchById}
        readOnly={guest}
      />
    </main>
  );
}
