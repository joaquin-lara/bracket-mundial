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

export interface Prediction {
  id: string;
  match_id: number;
  pred_home: number;
  pred_away: number;
  points: number | null;
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
