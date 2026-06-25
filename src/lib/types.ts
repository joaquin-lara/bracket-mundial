export interface Match {
  id: number;
  home_team: string;
  away_team: string;
  home_code: string | null;
  away_code: string | null;
  kickoff: string;
  stage: string;
  group_name: string | null;
  status: string;
  home_score: number | null;
  away_score: number | null;
  scored: boolean;
  venue: string | null;
  lineups?: MatchLineups | null;
  match_stats?: MatchStats | null;
}

export interface LineupPlayer {
  name: string;
  pos: string; // G / D / M / F
  grid: string | null; // "row:col" pitch position, row 1 = goalkeeper end
  number: number | null;
}
export interface TeamLineup {
  teamName: string;
  formation: string;
  startXI: LineupPlayer[];
}
export interface MatchLineups {
  home: TeamLineup;
  away: TeamLineup;
}

export interface TeamMatchStats {
  shotsOnGoal: number | null;
  shotsOffGoal: number | null;
  totalShots: number | null;
  blockedShots: number | null;
  shotsInsideBox: number | null;
  shotsOutsideBox: number | null;
  fouls: number | null;
  cornerKicks: number | null;
  offsides: number | null;
  possession: number | null; // parsed from "55%" -> 55
  yellowCards: number | null;
  redCards: number | null;
  goalkeeperSaves: number | null;
}
export interface MatchStats {
  home: TeamMatchStats;
  away: TeamMatchStats;
}

export interface Prediction {
  id: string;
  match_id: number;
  pred_home: number;
  pred_away: number;
  points: number | null;
}

export const GAMBLER_MARKETS = [
  'winner',
  'exact_score',
  'corners',
  'shots_on_goal',
  'shots_off_goal',
  'total_shots',
  'blocked_shots',
  'shots_inside_box',
  'shots_outside_box',
  'fouls',
  'yellow_cards',
  'red_cards',
  'possession',
] as const;
export type GamblerMarket = (typeof GAMBLER_MARKETS)[number];

export type GamblerSide = 'home' | 'away' | 'total';
export type GamblerComparator = 'over' | 'under' | 'eq';

// One row = one prediction on one match. winner/exact_score use `pick`/
// `pick_home_score`/`pick_away_score`; every other market uses `side` +
// `comparator` + `line` (the fixed threshold from gambler_market_odds).
export interface GamblerLeg {
  match_id: number;
  market: GamblerMarket;
  side: GamblerSide | null;
  comparator: GamblerComparator | null;
  line: number | null;
  pick: 'home' | 'draw' | 'away' | null;
  pick_home_score: number | null;
  pick_away_score: number | null;
}

export interface GamblerBet extends GamblerLeg {
  id: string;
  user_id: string;
  amount: number;
  payout_multiplier: number;
  status: 'pending' | 'won' | 'lost';
  payout: number | null;
  created_at: string;
  settled_at: string | null;
}

export interface GamblerParlayLeg extends GamblerLeg {
  id: string;
  ticket_id: string;
  payout_multiplier: number;
  status: 'pending' | 'won' | 'lost';
  leg_index: number;
}

export interface GamblerParlayTicket {
  id: string;
  user_id: string;
  amount: number;
  payout_multiplier: number;
  status: 'pending' | 'won' | 'lost';
  payout: number | null;
  created_at: string;
  settled_at: string | null;
}

export interface MarketOdds {
  market: GamblerMarket;
  side: GamblerSide | null;
  line: number | null;
  payout_multiplier: number;
}

export interface RevealedPick {
  match_id: number;
  display_name: string;
  pred_home: number;
  pred_away: number;
  points: number | null;
}

export const LOCK_MS = 10 * 60 * 1000;

export function lockTime(kickoff: string): number {
  return new Date(kickoff).getTime() - LOCK_MS;
}

// Everyone's picks become visible 5 minutes before kickoff. Picks lock 10
// minutes out, so by the reveal they're already final — no cheating window.
export const REVEAL_MS = 5 * 60 * 1000;

export function revealTime(kickoff: string): number {
  return new Date(kickoff).getTime() - REVEAL_MS;
}

export function stageLabel(stage: string, groupName: string | null): string {
  if (groupName) return groupName;
  const labels: Record<string, string> = {
    GROUP_STAGE: 'Group stage',
    LAST_32: 'Round of 32',
    LAST_16: 'Round of 16',
    ROUND_OF_32: 'Round of 32',
    ROUND_OF_16: 'Round of 16',
    QUARTER_FINALS: 'Quarter-finals',
    SEMI_FINALS: 'Semi-finals',
    THIRD_PLACE: 'Third place',
    FINAL: 'Final',
  };
  return labels[stage] ?? stage;
}
