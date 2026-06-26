'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Flag from './Flag';
import { flagUrl } from '@/lib/flags';
import { createClient } from '@/lib/supabase/client';
import {
  GAMBLER_MARKETS,
  lockTime,
  type GamblerBet,
  type GamblerComparator,
  type GamblerMarket,
  type GamblerParlayLeg,
  type GamblerParlayTicket,
  type GamblerSide,
  type MarketOdds,
} from '@/lib/types';

const MARKET_LABELS: Record<GamblerMarket, string> = {
  winner: 'Winner',
  exact_score: 'Exact score',
  corners: 'Corners',
  shots_on_goal: 'Shots on goal',
  shots_off_goal: 'Shots off goal',
  total_shots: 'Total shots',
  blocked_shots: 'Blocked shots',
  shots_inside_box: 'Shots inside box',
  shots_outside_box: 'Shots outside box',
  fouls: 'Fouls',
  yellow_cards: 'Yellow cards',
  red_cards: 'Red cards',
  possession: 'Possession',
};

export interface BettableMatch {
  id: number;
  homeCode: string;
  awayCode: string;
  homeName: string;
  awayName: string;
  stage: string;
  kickoff: string;
}

export interface LeaderboardRow {
  userId: string;
  name: string;
  flagCode: string | null;
  balance: number;
}

export type ParlayWithLegs = GamblerParlayTicket & { legs: GamblerParlayLeg[] };
export type AllParlayEntry = ParlayWithLegs & { playerName: string; flagCode: string | null };

// Stable empty set for cards with nothing taken yet -- avoids a fresh Set()
// (and a needless re-render) on every parent render.
const EMPTY_KEYS: Set<string> = new Set();

function fmt(n: number): string {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

// Side-aware: a per-team line and a match-total line differ by ~2x for most
// stat markets, so each (market, side) pair has its own row. winner/exact_score
// have a single row with side = null.
function oddsFor(odds: MarketOdds[], market: GamblerMarket, side: GamblerSide | null): MarketOdds | undefined {
  return odds.find((o) => o.market === market && (o.side ?? null) === side);
}

function marketHasOdds(odds: MarketOdds[], market: GamblerMarket): boolean {
  return odds.some((o) => o.market === market);
}

function lookupSideFor(leg: { market: GamblerMarket; side: GamblerSide | null }): GamblerSide | null {
  return leg.market === 'winner' || leg.market === 'exact_score' ? null : leg.side;
}

function pickName(m: { homeName: string; awayName: string } | undefined, pick: 'home' | 'draw' | 'away'): string {
  if (pick === 'draw') return 'Draw';
  if (!m) return pick === 'home' ? 'Home' : 'Away';
  return pick === 'home' ? m.homeName : m.awayName;
}

function sideName(m: { homeName: string; awayName: string } | undefined, side: GamblerSide): string {
  if (side === 'total') return 'Total';
  return pickName(m, side);
}

interface LegLike {
  market: GamblerMarket;
  side: GamblerSide | null;
  comparator: GamblerComparator | null;
  line: number | null;
  pick: 'home' | 'draw' | 'away' | null;
  pick_home_score: number | null;
  pick_away_score: number | null;
}

/** Human-readable description of any leg/bet, for history rows. */
function describeLeg(leg: LegLike, match: { homeName: string; awayName: string } | undefined): string {
  if (leg.market === 'winner') return `Winner: ${pickName(match, leg.pick!)}`;
  if (leg.market === 'exact_score') return `Score: ${leg.pick_home_score}–${leg.pick_away_score}`;
  const suffix = leg.market === 'possession' ? '%' : '';
  return `${MARKET_LABELS[leg.market]} (${sideName(match, leg.side!)}) ${leg.comparator} ${leg.line}${suffix}`;
}

// --- shared leg-input state, used by both BetMatchCard and ParlayBuilder ---

interface LegInput {
  market: GamblerMarket;
  pick: 'home' | 'draw' | 'away' | null;
  homeScore: string;
  awayScore: string;
  side: GamblerSide | null;
  comparator: GamblerComparator | null;
}

function emptyLeg(market: GamblerMarket = 'winner'): LegInput {
  return { market, pick: null, homeScore: '', awayScore: '', side: null, comparator: null };
}

function legComplete(leg: LegInput): boolean {
  if (leg.market === 'winner') return leg.pick != null;
  if (leg.market === 'exact_score') return leg.homeScore !== '' && leg.awayScore !== '';
  return leg.side != null && leg.comparator != null;
}

// Identifies the (market, side) a leg occupies, for duplicate detection. One
// such slot may hold at most one pending prediction per match -- mirrors the
// `gambler_market_taken` DB guard. winner/exact_score carry side = null, so
// they collapse to one bet per match regardless of which pick: betting "home
// wins" then blocks also betting "draw" or "away wins" on the same game.
function marketKey(market: GamblerMarket, side: GamblerSide | null): string {
  if (market === 'winner' || market === 'exact_score') return market;
  return `${market}|${side ?? ''}`;
}

function legUiKey(leg: LegInput): string {
  return marketKey(leg.market, leg.side);
}

function placedLegUiKey(bet: { market: GamblerMarket; side: GamblerSide | null }): string {
  return marketKey(bet.market, bet.side);
}

// First market not already taken on this match -- used to seed a fresh leg so
// the picker never opens on a winner/exact_score slot the user already filled.
function firstOpenMarket(markets: GamblerMarket[], takenKeys: Set<string>): GamblerMarket {
  return (
    markets.find((m) => !((m === 'winner' || m === 'exact_score') && takenKeys.has(m))) ??
    markets[0]
  );
}

/** Picks a market, then the market-specific inputs (pick / score / side+over-under). */
function MarketPicker({
  match,
  odds,
  leg,
  onChange,
  availableMarkets,
  takenKeys,
}: {
  match: BettableMatch;
  odds: MarketOdds[];
  leg: LegInput;
  onChange: (leg: LegInput) => void;
  availableMarkets: GamblerMarket[];
  takenKeys: Set<string>;
}) {
  const sideOptions = (leg.market === 'possession' ? (['home', 'away'] as const) : (['home', 'away', 'total'] as const)).filter(
    (s) => oddsFor(odds, leg.market, s) != null
  );
  const currentForSide = leg.side ? oddsFor(odds, leg.market, leg.side) : undefined;
  return (
    <div className="gb-market-picker">
      <select
        className="gb-select"
        value={leg.market}
        onChange={(e) => onChange(emptyLeg(e.target.value as GamblerMarket))}
      >
        {availableMarkets.map((market) => {
          const taken = (market === 'winner' || market === 'exact_score') && takenKeys.has(market);
          return (
            <option key={market} value={market} disabled={taken}>
              {MARKET_LABELS[market]}
              {taken ? ' (placed)' : ''}
            </option>
          );
        })}
      </select>

      {leg.market === 'winner' && (
        <div className="gb-pick-group">
          {(['home', 'draw', 'away'] as const).map((p) => (
            <button
              key={p}
              type="button"
              className={`gb-pick-btn${leg.pick === p ? ' active' : ''}`}
              disabled={takenKeys.has('winner')}
              onClick={() => onChange({ ...leg, pick: p })}
            >
              {pickName(match, p)}
            </button>
          ))}
        </div>
      )}

      {leg.market === 'exact_score' && (
        <div className="gb-score-row">
          <input
            type="number"
            min={0}
            step={1}
            placeholder="0"
            value={leg.homeScore}
            onChange={(e) => onChange({ ...leg, homeScore: e.target.value })}
            className="gb-score-input"
          />
          <span className="gb-dash">–</span>
          <input
            type="number"
            min={0}
            step={1}
            placeholder="0"
            value={leg.awayScore}
            onChange={(e) => onChange({ ...leg, awayScore: e.target.value })}
            className="gb-score-input"
          />
        </div>
      )}

      {leg.market !== 'winner' && leg.market !== 'exact_score' && (
        <>
          <div className="gb-pick-group">
            {sideOptions.map((s) => {
              const taken = takenKeys.has(`${leg.market}|${s}`);
              return (
                <button
                  key={s}
                  type="button"
                  className={`gb-pick-btn${leg.side === s ? ' active' : ''}`}
                  disabled={taken}
                  title={taken ? 'Already placed for this match' : undefined}
                  onClick={() => onChange({ ...leg, side: s, comparator: null })}
                >
                  {sideName(match, s)}
                </button>
              );
            })}
          </div>
          {currentForSide && (
            <div className="gb-pick-group">
              {(['over', 'under'] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`gb-pick-btn${leg.comparator === c ? ' active' : ''}`}
                  onClick={() => onChange({ ...leg, comparator: c })}
                >
                  {c} {currentForSide.line}
                  {leg.market === 'possession' ? '%' : ''}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Line isn't user-chosen -- it's whatever gambler_market_odds fixes for this
// market/side, so the RPC payload looks it up from the same odds list the
// picker rendered against rather than trusting client state.
function legRpcArgs(matchId: number, leg: LegInput, odds: MarketOdds[]) {
  const side = lookupSideFor(leg);
  return {
    match_id: matchId,
    market: leg.market,
    side,
    comparator: leg.market === 'winner' || leg.market === 'exact_score' ? null : leg.comparator,
    line: oddsFor(odds, leg.market, side)?.line ?? null,
    pick: leg.market === 'winner' ? leg.pick : null,
    pick_home_score: leg.market === 'exact_score' ? Math.trunc(Number(leg.homeScore)) : null,
    pick_away_score: leg.market === 'exact_score' ? Math.trunc(Number(leg.awayScore)) : null,
  };
}

const MAX_CARD_LEGS = 4;

function BetMatchCard({
  match,
  bets,
  odds,
  balance,
  takenKeys,
  onPlaced,
  onCancel,
}: {
  match: BettableMatch;
  bets: GamblerBet[];
  odds: MarketOdds[];
  balance: number;
  takenKeys: Set<string>;
  onPlaced: (amount: number) => void;
  onCancel: (bet: GamblerBet) => void;
}) {
  const router = useRouter();
  const availableMarkets = GAMBLER_MARKETS.filter((m) => marketHasOdds(odds, m));
  const [legs, setLegs] = useState<LegInput[]>([emptyLeg(firstOpenMarket(availableMarkets, takenKeys))]);
  const [amount, setAmount] = useState('50');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const legKeys = legs.map(legUiKey);
  const hasDuplicate = new Set(legKeys).size !== legKeys.length || legKeys.some((k) => takenKeys.has(k));
  const allComplete = legs.every(legComplete);
  const ready = allComplete && !hasDuplicate;

  const totalMultiplier = legs.reduce((total, l) => {
    const o = oddsFor(odds, l.market, lookupSideFor(l));
    return o ? total * o.payout_multiplier : total;
  }, 1);
  const boostPct = Math.round((totalMultiplier - 1) * 100);

  function updateLeg(i: number, l: LegInput) {
    setLegs((a) => a.map((prev, j) => (j === i ? l : prev)));
  }
  function addLeg() {
    if (legs.length >= MAX_CARD_LEGS) return;
    setLegs((a) => [...a, emptyLeg(firstOpenMarket(availableMarkets, takenKeys))]);
  }
  function removeLeg(i: number) {
    if (legs.length <= 1) return;
    setLegs((a) => a.filter((_, j) => j !== i));
  }

  async function submit() {
    setError(null);
    const amt = Math.trunc(Number(amount));
    if (!ready) {
      setError(hasDuplicate ? "You've already picked that market." : 'Finish every pick first.');
      return;
    }
    if (!Number.isInteger(amt) || amt <= 0) {
      setError('Enter a whole-dollar amount.');
      return;
    }
    if (amt > balance) {
      setError("That's more than your balance.");
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { error: rpcError } =
      legs.length === 1
        ? await (async () => {
            const args = legRpcArgs(match.id, legs[0], odds);
            return supabase.rpc('gambler_place_bet', {
              p_match_id: args.match_id,
              p_market: args.market,
              p_side: args.side,
              p_comparator: args.comparator,
              p_line: args.line,
              p_pick: args.pick,
              p_pick_home_score: args.pick_home_score,
              p_pick_away_score: args.pick_away_score,
              p_amount: amt,
            });
          })()
        : await supabase.rpc('gambler_place_parlay_v2', {
            p_legs: legs.map((l) => legRpcArgs(match.id, l, odds)),
            p_amount: amt,
          });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    onPlaced(amt);
    setLegs([emptyLeg(firstOpenMarket(availableMarkets, takenKeys))]);
    router.refresh();
  }

  return (
    <div className="gb-card">
      <div className="gb-card-top">
        <span className="gb-team">
          <Flag code={match.homeCode} name={match.homeName} />
          {match.homeName}
        </span>
        <span className="gb-meta">
          {match.stage} ·{' '}
          {new Date(match.kickoff).toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
        <span className="gb-team gb-team-right">
          {match.awayName}
          <Flag code={match.awayCode} name={match.awayName} />
        </span>
      </div>

      {bets.length > 0 && (
        <div className="gb-placed-list">
          {bets.map((b) => (
            <div className={`gb-placed gb-placed-${b.status}`} key={b.id}>
              <span className="gb-placed-text">
                {describeLeg(b, match)} — {fmt(b.amount)}
                {b.status !== 'pending' && (
                  <> ({b.status === 'won' ? `won ${fmt(b.payout ?? 0)}` : 'lost'})</>
                )}
              </span>
              {b.status === 'pending' && (
                <button type="button" className="gb-remove" onClick={() => onCancel(b)}>
                  remove
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="gb-bet-row">
        <span className="gb-bet-label">
          {legs.length > 1 ? 'Build a parlay' : 'Place a bet'}{' '}
          <span className="gb-mult">
            {totalMultiplier.toFixed(2)}x{boostPct > 0 && ` (+${boostPct}%)`}
          </span>
        </span>
        <div className="gb-bet-form">
          {legs.map((leg, i) => (
            <div className="gb-leg-slot" key={i}>
              <MarketPicker match={match} odds={odds} leg={leg} onChange={(l) => updateLeg(i, l)} availableMarkets={availableMarkets} takenKeys={takenKeys} />
              {legs.length > 1 && (
                <button type="button" className="gb-leg-remove" onClick={() => removeLeg(i)} title="Remove this pick">
                  remove
                </button>
              )}
            </div>
          ))}

          {legs.length < MAX_CARD_LEGS && (
            <button type="button" className="gb-add-leg" onClick={addLeg}>
              + add another market
            </button>
          )}

          <div className="gb-amount-row">
            <span className="gb-dollar">$</span>
            <input
              type="number"
              min={1}
              step={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="gb-amount-input"
            />
            <button type="button" disabled={!ready || busy} onClick={submit}>
              {busy ? 'Placing…' : legs.length > 1 ? `Place parlay (${legs.length})` : 'Place bet'}
            </button>
          </div>
        </div>
      </div>

      {error && <p className="gb-error">{error}</p>}
    </div>
  );
}

/** Bragging-rights box: everyone's parlays (pending + settled), most recent first. */
function AllParlaysBoard({
  parlays,
  matchById,
}: {
  parlays: AllParlayEntry[];
  matchById: Record<number, { homeName: string; awayName: string }>;
}) {
  if (parlays.length === 0) {
    return <p className="empty">No parlays placed yet — be the first.</p>;
  }
  return (
    <div className="gb-all-parlays">
      {parlays.map((p) => (
        <div className={`gb-all-parlay-row gb-placed-${p.status}`} key={p.id}>
          <div className="gb-all-parlay-player">
            {p.flagCode && flagUrl(p.flagCode) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={flagUrl(p.flagCode)!} alt="" className="gb-lb-flag" />
            ) : (
              <span className="gb-lb-flag gb-lb-flag-blank" />
            )}
            <span className="gb-all-parlay-name">{p.playerName}</span>
            <span className="gb-mult">{p.payout_multiplier.toFixed(2)}x</span>
          </div>
          <div className="gb-all-parlay-legs">
            {p.legs.map((leg) => describeLeg(leg, matchById[leg.match_id])).join(' + ')}
          </div>
          <div className="gb-all-parlay-foot">
            <span>{fmt(p.amount)} bet</span>
            <span>
              {p.status === 'pending' ? 'Pending' : p.status === 'won' ? `+${fmt(p.payout ?? 0)}` : `-${fmt(p.amount)}`}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function GamblersBoard({
  matches,
  odds,
  leaderboard,
  allParlays,
  myBets,
  myParlays,
  myUserId,
  myBalance,
  matchById,
  readOnly,
}: {
  matches: BettableMatch[];
  odds: MarketOdds[];
  leaderboard: LeaderboardRow[];
  allParlays: AllParlayEntry[];
  myBets: GamblerBet[];
  myParlays: ParlayWithLegs[];
  myUserId: string;
  myBalance: number;
  matchById: Record<number, { homeName: string; awayName: string; kickoff?: string }>;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [balance, setBalance] = useState(myBalance);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const betsByMatch = useMemo(() => {
    const map = new Map<number, GamblerBet[]>();
    for (const b of myBets) {
      const arr = map.get(b.match_id) ?? [];
      arr.push(b);
      map.set(b.match_id, arr);
    }
    return map;
  }, [myBets]);

  // Every (match, market, side) the user already holds, across BOTH standalone
  // bets and pending parlay legs -- the picker greys these out and the duplicate
  // guard blocks re-selecting them, matching the `gambler_market_taken` DB check.
  const takenByMatch = useMemo(() => {
    const map = new Map<number, Set<string>>();
    const add = (matchId: number, key: string) => {
      const set = map.get(matchId) ?? new Set<string>();
      set.add(key);
      map.set(matchId, set);
    };
    for (const b of myBets) if (b.status === 'pending') add(b.match_id, placedLegUiKey(b));
    for (const p of myParlays) {
      if (p.status !== 'pending') continue;
      for (const leg of p.legs) add(leg.match_id, placedLegUiKey(leg));
    }
    return map;
  }, [myBets, myParlays]);

  const pendingBets = myBets.filter((b) => b.status === 'pending');
  const settledBets = myBets.filter((b) => b.status !== 'pending');

  function matchLocked(matchId: number): boolean {
    const kickoff = matchById[matchId]?.kickoff;
    return kickoff ? lockTime(kickoff) <= Date.now() : false;
  }

  async function cancel(rpc: 'gambler_cancel_bet' | 'gambler_cancel_parlay', id: string, refund: number) {
    setActionError(null);
    setBusyId(id);
    const supabase = createClient();
    const arg = rpc === 'gambler_cancel_bet' ? { p_bet_id: id } : { p_ticket_id: id };
    const { error } = await supabase.rpc(rpc, arg);
    setBusyId(null);
    if (error) {
      setActionError(error.message);
      return;
    }
    setBalance((b) => b + refund);
    router.refresh();
  }

  const cancelBet = (bet: GamblerBet) => cancel('gambler_cancel_bet', bet.id, bet.amount);
  const cancelParlay = (p: ParlayWithLegs) => cancel('gambler_cancel_parlay', p.id, p.amount);

  return (
    <>
      {!readOnly && (
        <div className="gb-balance">
          Your balance <strong>{fmt(balance)}</strong>
        </div>
      )}

      <div className="gb-top-grid">
        <section className="gb-section gb-top-grid-col">
          <h2 className="gb-h2">Leaderboard</h2>
          <div className="gb-leaderboard">
            {leaderboard.map((row, i) => (
              <div className={`gb-lb-row${row.userId === myUserId ? ' me' : ''}`} key={row.userId}>
                <span className="gb-lb-rank">#{i + 1}</span>
                {row.flagCode && flagUrl(row.flagCode) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={flagUrl(row.flagCode)!} alt="" className="gb-lb-flag" />
                ) : (
                  <span className="gb-lb-flag gb-lb-flag-blank" />
                )}
                <span className="gb-lb-name">{row.name}</span>
                <span className="gb-lb-balance">{fmt(row.balance)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="gb-section gb-top-grid-col">
          <h2 className="gb-h2">All parlays</h2>
          <AllParlaysBoard parlays={allParlays} matchById={matchById} />
        </section>
      </div>

      {!readOnly && (
        <section className="gb-section">
          <h2 className="gb-h2">Open matches</h2>
          {matches.length === 0 ? (
            <p className="empty">No matches open for betting right now — check back closer to kickoff.</p>
          ) : (
            <div className="gb-cards">
              {matches.map((m) => (
                <BetMatchCard
                  key={m.id}
                  match={m}
                  bets={betsByMatch.get(m.id) ?? []}
                  odds={odds}
                  balance={balance}
                  takenKeys={takenByMatch.get(m.id) ?? EMPTY_KEYS}
                  onPlaced={(amount) => setBalance((b) => b - amount)}
                  onCancel={cancelBet}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {!readOnly && actionError && <p className="gb-error">{actionError}</p>}

      {!readOnly && pendingBets.length > 0 && (
        <section className="gb-section">
          <h2 className="gb-h2">Your open bets</h2>
          <div className="gb-history">
            {pendingBets.map((b) => {
              const m = matchById[b.match_id];
              const locked = matchLocked(b.match_id);
              return (
                <div className="gb-history-row gb-placed-pending" key={b.id}>
                  <span>{m ? `${m.homeName} vs ${m.awayName}` : `Match #${b.match_id}`}</span>
                  <span>{describeLeg(b, m)}</span>
                  <span>{fmt(b.amount)} bet</span>
                  <span>
                    {locked ? (
                      <span className="gb-locked">Locked</span>
                    ) : (
                      <button
                        type="button"
                        className="gb-remove"
                        disabled={busyId === b.id}
                        onClick={() => cancelBet(b)}
                      >
                        {busyId === b.id ? 'Removing…' : 'Remove'}
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {!readOnly && myParlays.length > 0 && (
        <section className="gb-section">
          <h2 className="gb-h2">Your parlays</h2>
          <div className="gb-history">
            {myParlays.map((p) => {
              const locked = p.legs.some((leg) => matchLocked(leg.match_id));
              return (
                <div className={`gb-history-row gb-placed-${p.status}`} key={p.id}>
                  <span>{p.legs.map((leg) => describeLeg(leg, matchById[leg.match_id])).join(' + ')}</span>
                  <span>{p.status === 'pending' ? 'Pending' : p.status === 'won' ? 'Won' : 'Lost'}</span>
                  <span>{fmt(p.amount)} bet</span>
                  <span>
                    {p.status === 'pending' && !locked ? (
                      <button
                        type="button"
                        className="gb-remove"
                        disabled={busyId === p.id}
                        onClick={() => cancelParlay(p)}
                      >
                        {busyId === p.id ? 'Removing…' : 'Remove'}
                      </button>
                    ) : p.status === 'won' ? (
                      `+${fmt(p.payout ?? 0)}`
                    ) : p.status === 'lost' ? (
                      `-${fmt(p.amount)}`
                    ) : (
                      '—'
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {!readOnly && settledBets.length > 0 && (
        <section className="gb-section">
          <h2 className="gb-h2">Your settled bets</h2>
          <div className="gb-history">
            {settledBets.map((b) => {
              const m = matchById[b.match_id];
              return (
                <div className={`gb-history-row gb-placed-${b.status}`} key={b.id}>
                  <span>{m ? `${m.homeName} vs ${m.awayName}` : `Match #${b.match_id}`}</span>
                  <span>{describeLeg(b, m)}</span>
                  <span>{fmt(b.amount)} bet</span>
                  <span>{b.status === 'won' ? `+${fmt(b.payout ?? 0)}` : `-${fmt(b.amount)}`}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

    </>
  );
}
