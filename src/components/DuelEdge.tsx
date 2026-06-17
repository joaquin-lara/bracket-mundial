'use client';

import { useMemo } from 'react';
import { computeReco, DIRS, type Pick } from '@/lib/duelEdge';

interface Round { kick: number; shooter: string; shot: Pick; dive: Pick; goal: boolean }
interface DuelLike { id: string; challenger: string; opponent: string; rounds: Round[] }

const ARROW: Record<Pick, string> = { left: '← LEFT', center: '• CENTER', right: 'RIGHT →' };
const CONF_LABEL = { low: 'thin read', med: 'decent read', high: 'strong read' } as const;

/**
 * Private edge readout for the current kick — visible only to Joaquin. Predicts
 * the opponent's pick from past duels and recommends the counter. Uses only
 * already-revealed rounds; no access to the opponent's hidden current pick.
 */
export default function DuelEdge({
  duels,
  me,
  oppId,
  oppName,
  role,
  currentDuelId,
}: {
  duels: DuelLike[];
  me: string;
  oppId: string;
  oppName: string;
  role: 'shoot' | 'keep';
  currentDuelId: string | null;
}) {
  const reco = useMemo(
    () => computeReco(duels, me, oppId, role, currentDuelId),
    [duels, me, oppId, role, currentDuelId]
  );

  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const edge = reco.successChance - reco.baseline;
  const action = role === 'keep' ? 'DIVE' : 'SHOOT';
  const predictLabel = role === 'keep' ? `${oppName} shoots` : `${oppName} dives`;

  return (
    <div
      style={{
        margin: '14px auto 0',
        maxWidth: 360,
        border: '1px solid rgba(230,179,55,0.5)',
        borderRadius: 10,
        background: 'rgba(4,21,15,0.6)',
        padding: '10px 12px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, color: 'var(--gold)' }}>
          EDGE · ONLY YOU SEE THIS
        </span>
        <span style={{ fontSize: 10.5, color: 'var(--dim)' }}>
          {reco.n} kicks · {CONF_LABEL[reco.confidence]}
        </span>
      </div>

      {reco.n === 0 ? (
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 6 }}>
          No history vs {oppName} yet — play some and reads will build here.
        </div>
      ) : (
        <>
          <div style={{ marginTop: 6, fontSize: 16, fontWeight: 800, color: 'var(--cream)' }}>
            {action} {ARROW[reco.recommend]}
            <span style={{ fontSize: 12, fontWeight: 600, color: edge > 0.02 ? 'rgb(52,211,153)' : 'var(--dim)', marginLeft: 8 }}>
              {role === 'keep' ? 'save' : 'goal'} ~{pct(reco.successChance)}
              {edge > 0.02 ? ` (+${pct(edge)})` : ''}
            </span>
          </div>

          <div style={{ fontSize: 10.5, color: 'var(--dim)', margin: '8px 0 3px' }}>{predictLabel}</div>
          {DIRS.map((d) => {
            const p = reco.predict[d];
            const hot = d === reco.recommend;
            return (
              <div key={d} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 0' }}>
                <span style={{ width: 48, fontSize: 11, color: 'var(--muted)', textTransform: 'capitalize' }}>{d}</span>
                <div style={{ flex: 1, height: 9, borderRadius: 5, background: 'rgba(244,241,232,0.1)', overflow: 'hidden' }}>
                  <span style={{ display: 'block', height: '100%', width: pct(p), background: hot ? 'var(--gold)' : 'rgba(244,241,232,0.35)' }} />
                </div>
                <span style={{ width: 32, textAlign: 'right', fontSize: 11, fontVariantNumeric: 'tabular-nums', color: hot ? 'var(--gold)' : 'var(--muted)' }}>{pct(p)}</span>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
