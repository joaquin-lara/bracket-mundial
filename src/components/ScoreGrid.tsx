import { Fragment } from 'react';
import type { TeamRating } from '@/lib/ml/teams';

/** Heatmap of exact-scoreline probabilities (home goals = rows, away = columns). */
export default function ScoreGrid({ grid, home, away }: { grid: number[][]; home: TeamRating; away: TeamRating }) {
  const max = Math.max(...grid.flat(), 0.0001);
  const head: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#0b5f3a', textAlign: 'center', padding: 2 };
  const cellBase: React.CSSProperties = { textAlign: 'center', padding: '6px 0', fontSize: 12, borderRadius: 4 };

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontWeight: 700, marginBottom: 2 }}>Scoreline probability</div>
      <div style={{ fontSize: 12, color: '#667', marginBottom: 8 }}>
        {home.name} goals down the side, {away.name} across the top. Darker = more likely. The diagonal is draws.
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `auto repeat(6, 1fr)`,
          gap: 3,
          maxWidth: 380,
        }}
      >
        <div />
        {[0, 1, 2, 3, 4, 5].map((a) => (
          <div key={`h${a}`} style={head}>{a}{a === 5 ? '+' : ''}</div>
        ))}
        {[0, 1, 2, 3, 4, 5].map((h) => (
          <Fragment key={`r${h}`}>
            <div style={{ ...head, display: 'flex', alignItems: 'center' }}>{h}{h === 5 ? '+' : ''}</div>
            {[0, 1, 2, 3, 4, 5].map((a) => {
              const p = grid[h]?.[a] ?? 0;
              const t = p / max; // 0..1 intensity
              const draw = h === a;
              const rgb = draw ? '193,140,30' : '11,95,58';
              return (
                <div
                  key={a}
                  title={`${h}–${a}: ${(p * 100).toFixed(1)}%`}
                  style={{
                    ...cellBase,
                    background: `rgba(${rgb}, ${0.08 + 0.9 * t})`,
                    color: t > 0.5 ? '#fff' : '#334',
                    fontWeight: t > 0.6 ? 700 : 400,
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
