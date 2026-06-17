import type { MatchLineups, TeamLineup } from '@/lib/types';
import { lookup } from '@/lib/ml/teams';
import Pitch from './Pitch';
import ChartTag from './ChartTag';
import { fromConfirmed } from '@/lib/lineupLayout';

function OneTeam({ team, accent }: { team: TeamLineup; accent: string }) {
  return (
    <div style={{ flex: '1 1 200px', minWidth: 180, textAlign: 'center' }}>
      <div style={{ fontWeight: 700, color: 'var(--cream)', fontSize: 13.5 }}>{team.teamName}</div>
      <div style={{ fontSize: 12, color: 'var(--gold)', marginBottom: 6, fontWeight: 700 }}>{team.formation}</div>
      <Pitch players={fromConfirmed(team.startXI)} accent={accent} formation={team.formation} />
    </div>
  );
}

/**
 * Real confirmed starting XIs (API-Football), oriented so `leftCode` is on the
 * left. Falls back to the stored home/away order if team names don't resolve.
 */
export default function ConfirmedLineups({
  lineups,
  leftCode,
}: {
  lineups: MatchLineups;
  leftCode: string | null;
}) {
  const homeCode = lookup(lineups.home.teamName)?.code ?? null;
  const leftIsHome = leftCode == null || homeCode == null || homeCode === leftCode;
  const left = leftIsHome ? lineups.home : lineups.away;
  const right = leftIsHome ? lineups.away : lineups.home;

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontWeight: 800, marginBottom: 2, color: 'var(--cream)', textAlign: 'center' }}>
        Confirmed lineups<ChartTag kind="history" />
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10, textAlign: 'center' }}>
        Official starting XIs for this match.
      </div>
      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
        <OneTeam team={left} accent="rgb(52,211,153)" />
        <OneTeam team={right} accent="rgb(230,179,55)" />
      </div>
    </div>
  );
}
