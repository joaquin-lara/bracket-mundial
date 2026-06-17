import { TEAMS, type TeamRating } from '@/lib/ml/teams';
import ChartTag from './ChartTag';

// Five axes, each scored 0..1 by min-max across the 48 WC teams so the shape is
// readable rather than dominated by raw-unit scale differences. Squad falls back
// to the field midpoint when a team has no FIFA rating (it never zeroes a corner).
const AXES = [
  { key: 'Attack', get: (t: TeamRating) => t.dcAtt },
  { key: 'Defence', get: (t: TeamRating) => t.dcDef },
  { key: 'Strength', get: (t: TeamRating) => t.elo },
  { key: 'Form', get: (t: TeamRating) => formPoints(t) },
  { key: 'Squad', get: (t: TeamRating) => t.squad ?? null },
] as const;

/** Points-per-game over the recent form window (0..3), or 1.0 when none played. */
function formPoints(t: TeamRating): number {
  const f = t.form;
  if (!f || f.played === 0) return 1;
  return (f.won * 3 + f.drawn) / f.played;
}

// Pre-compute each axis's min/max over all rated teams so normalisation is stable.
const RANGES = AXES.map((ax) => {
  const vals = TEAMS.map(ax.get).filter((v): v is number => v != null);
  return { min: Math.min(...vals), max: Math.max(...vals) };
});

function norm(value: number | null, i: number): number {
  if (value == null) return 0.5; // no squad data -> midpoint
  const { min, max } = RANGES[i];
  if (max <= min) return 0.5;
  return Math.max(0.04, Math.min(1, (value - min) / (max - min)));
}

const SIZE = 240;
const C = SIZE / 2;
const R = SIZE / 2 - 34; // leave room for labels

function point(i: number, radius: number): [number, number] {
  const angle = -Math.PI / 2 + (i * 2 * Math.PI) / AXES.length;
  return [C + Math.cos(angle) * radius, C + Math.sin(angle) * radius];
}

function polygon(team: TeamRating): string {
  return AXES.map((ax, i) => {
    const [x, y] = point(i, norm(ax.get(team), i) * R);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

/** Overlaid radar comparing two teams across attack/defence/strength/form/squad. */
export default function TeamRadar({ home, away }: { home: TeamRating; away: TeamRating }) {
  const rings = [0.25, 0.5, 0.75, 1];
  const HOME = '52,211,153'; // emerald
  const AWAY = '230,179,55'; // gold

  return (
    <div style={{ marginTop: 22, textAlign: 'center' }}>
      <div style={{ fontWeight: 800, marginBottom: 2, color: 'var(--cream)' }}>Team comparison<ChartTag kind="prediction" /></div>
      <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 8 }}>
        Based on the model&apos;s ratings — attack, defence, Elo strength, recent form and squad talent — each axis scored against all 48 World Cup teams. Bigger shape = stronger.
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, flexWrap: 'wrap' }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img"
          aria-label={`Radar comparing ${home.name} and ${away.name}`}>
          {rings.map((r, ri) => (
            <polygon key={ri}
              points={AXES.map((_, i) => point(i, r * R).map((n) => n.toFixed(1)).join(',')).join(' ')}
              fill="none" stroke="rgba(244,241,232,0.16)" strokeWidth={1} />
          ))}
          {AXES.map((_, i) => {
            const [x, y] = point(i, R);
            return <line key={i} x1={C} y1={C} x2={x} y2={y} stroke="rgba(244,241,232,0.16)" strokeWidth={1} />;
          })}
          <polygon points={polygon(away)} fill={`rgba(${AWAY},0.22)`} stroke={`rgb(${AWAY})`} strokeWidth={2.5} />
          <polygon points={polygon(home)} fill={`rgba(${HOME},0.22)`} stroke={`rgb(${HOME})`} strokeWidth={2.5} />
          {AXES.map((ax, i) => {
            const [x, y] = point(i, R + 16);
            return (
              <text key={ax.key} x={x} y={y} fontSize={11.5} fontWeight={700} fill="var(--cream)"
                textAnchor="middle" dominantBaseline="middle">{ax.key}</text>
            );
          })}
        </svg>
        <div style={{ fontSize: 13.5, color: 'var(--cream)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <span style={{ width: 14, height: 14, borderRadius: 3, background: `rgb(${HOME})`, display: 'inline-block' }} />
            {home.name}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 14, height: 14, borderRadius: 3, background: `rgb(${AWAY})`, display: 'inline-block' }} />
            {away.name}
          </div>
        </div>
      </div>
    </div>
  );
}
