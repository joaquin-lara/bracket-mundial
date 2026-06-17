import type { MatchLineups } from '@/lib/types';
import { lookup } from '@/lib/ml/teams';
import TeamPitch from './TeamPitch';
import ChartTag from './ChartTag';

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
        <TeamPitch teamName={left.teamName} lineup={left} accent="rgb(52,211,153)" />
        <TeamPitch teamName={right.teamName} lineup={right} accent="rgb(230,179,55)" />
      </div>
    </div>
  );
}
