import { Fragment } from 'react';
import type { TeamRating } from '@/lib/ml/teams';

/** Heatmap of exact-scoreline probabilities (home goals = rows, away = columns). */
export default function ScoreGrid({ grid, home, away }: { grid: number[][]; home: TeamRating; away: TeamRating }) {
  const max = Math.max(...grid.flat(), 0.0001);
  const head: React.CSSProperties = { fontSize: 12, fontWeight: 800, color: 'var(--gold)', textAlign: 'center', padding: 2 };
  const cellBase: React.CSSProperties = { textAlign: 'center', padding: '7px 0', fontSize: 12, borderRadius: 4, fontVariantNumeric: 'tabular-nums' };

  return (
    <div style={{ marginTop: 22, textAlign: 'center' }}>
      <div style={{ fontWeight: 800, marginBottom: 2, color: 'var(--cream)' }}>Scoreline probability</div>
      <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10 }}>
        {home.name} goals down the side, {away.name} across the top. Brighter = more likely; the diagonal (gold) is draws.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `1.4rem repeat(6, 1fr)`, gap: 3, maxWidth: 400, margin: '0 auto' }}>
        <div />
        {[0, 1, 2, 3, 4, 5].map((a) => (
          <div key={`h${a}`} style={head}>{a}{a === 5 ? '+' : ''}</div>
        ))}
        {[0, 1, 2, 3, 4, 5].map((h) => (
          <Fragment key={`r${h}`}>
            <div style={{ ...head, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{h}{h === 5 ? '+' : ''}</div>
            {[0, 1, 2, 3, 4, 5].map((a) => {
              const p = grid[h]?.[a] ?? 0;
              const t = p / max; // 0..1 intensity
              const draw = h === a;
              const rgb = draw ? '230,179,55' : '52,211,153'; // gold draws, emerald otherwise
              return (
                <div
                  key={a}
                  title={`${h}–${a}: ${(p * 100).toFixed(1)}%`}
                  style={{
                    ...cellBase,
                    background: `rgba(${rgb}, ${0.06 + 0.94 * t})`,
                    color: t > 0.45 ? '#06281c' : 'var(--muted)',
                    fontWeight: t > 0.4 ? 800 : 500,
                  }}
                >
                  {(p * 100).toFixed(0)}
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
