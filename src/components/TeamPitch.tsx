import type { TeamLineup } from '@/lib/types';
import Pitch from './Pitch';
import { fromConfirmed } from '@/lib/lineupLayout';

/**
 * One team's XI on a pitch with a name, formation and optional caption. Renders
 * `emptyNote` when there's no lineup. Used for both the live confirmed XI and a
 * team's most recent World Cup match.
 */
export default function TeamPitch({
  teamName,
  lineup,
  accent,
  caption,
  emptyNote = 'No lineup on record.',
}: {
  teamName: string;
  lineup: TeamLineup | null;
  accent: string;
  caption?: string;
  emptyNote?: string;
}) {
  return (
    <div style={{ flex: '1 1 200px', minWidth: 180, textAlign: 'center' }}>
      <div style={{ fontWeight: 700, color: 'var(--cream)', fontSize: 13.5 }}>{teamName}</div>
      {lineup ? (
        <>
          <div style={{ fontSize: 12, color: 'var(--gold)', marginBottom: 6, fontWeight: 700 }}>{lineup.formation}</div>
          <Pitch players={fromConfirmed(lineup.startXI)} accent={accent} formation={lineup.formation} />
          {caption && <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 4 }}>{caption}</div>}
        </>
      ) : (
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 30 }}>{emptyNote}</div>
      )}
    </div>
  );
}
