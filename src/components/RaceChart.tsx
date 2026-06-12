'use client';

import { PLAYER_META, type Player } from '@/lib/players';

export interface RacePoint {
  name: string;
  kickoff: string; // ISO; grouped into the viewer's local match days
  points: number;
}

const W = 680;
const H = 300;
const PAD = { l: 36, r: 92, t: 16, b: 34 };

function playerColor(name: string): string {
  return PLAYER_META[name as Player]?.color ?? '#e6b337';
}

/** Cumulative points per player, by match day. The season story arc. */
export default function RaceChart({ entries }: { entries: RacePoint[] }) {
  if (entries.length === 0) {
    return (
      <div className="race-card">
        <div className="race-title">Points race</div>
        <p className="empty">The race starts once the first games are scored.</p>
      </div>
    );
  }

  const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA');
  const days = [...new Set(entries.map((e) => dayOf(e.kickoff)))].sort();
  const players = [...new Set(entries.map((e) => e.name))].sort();

  // points earned per player per day
  const earned = new Map<string, Map<string, number>>();
  for (const e of entries) {
    const d = dayOf(e.kickoff);
    if (!earned.has(e.name)) earned.set(e.name, new Map());
    const m = earned.get(e.name)!;
    m.set(d, (m.get(d) ?? 0) + e.points);
  }

  // cumulative series per player across all days
  const series = players.map((name) => {
    let sum = 0;
    const values = days.map((d) => {
      sum += earned.get(name)?.get(d) ?? 0;
      return sum;
    });
    return { name, values, total: sum };
  });

  const maxPts = Math.max(4, ...series.map((s) => s.total));
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const x = (i: number) =>
    days.length === 1 ? PAD.l + innerW / 2 : PAD.l + (i * innerW) / (days.length - 1);
  const y = (p: number) => PAD.t + (1 - p / maxPts) * innerH;

  // y-axis ticks (integers)
  const step = Math.max(1, Math.ceil(maxPts / 4));
  const ticks: number[] = [];
  for (let v = 0; v <= maxPts; v += step) ticks.push(v);

  // x labels: at most ~6, evenly thinned
  const every = Math.max(1, Math.ceil(days.length / 6));
  const dayLabel = (d: string) =>
    new Date(`${d}T12:00:00`)
      .toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      .toUpperCase();

  // end labels, pushed apart so they never overlap
  const labels = series
    .map((s) => ({ name: s.name, total: s.total, ly: y(s.total) }))
    .sort((a, b) => a.ly - b.ly);
  for (let i = 1; i < labels.length; i++) {
    if (labels[i].ly - labels[i - 1].ly < 15) labels[i].ly = labels[i - 1].ly + 15;
  }
  const labelY = new Map(labels.map((l) => [l.name, l.ly]));

  return (
    <div className="race-card">
      <div className="race-title">Points race</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="race-svg" role="img" aria-label="Cumulative points per player by match day">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} y1={y(v)} x2={W - PAD.r} y2={y(v)} className="rc-grid" />
            <text x={PAD.l - 8} y={y(v) + 3} textAnchor="end" className="rc-axis">
              {v}
            </text>
          </g>
        ))}

        {days.map((d, i) =>
          i % every === 0 || i === days.length - 1 ? (
            <text key={d} x={x(i)} y={H - PAD.b + 18} textAnchor="middle" className="rc-axis">
              {dayLabel(d)}
            </text>
          ) : null
        )}

        {series.map((s) => (
          <g key={s.name}>
            <polyline
              points={s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}
              fill="none"
              stroke={playerColor(s.name)}
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {s.values.map((v, i) => (
              <circle key={i} cx={x(i)} cy={y(v)} r="3" fill={playerColor(s.name)} />
            ))}
            <text
              x={W - PAD.r + 10}
              y={(labelY.get(s.name) ?? y(s.total)) + 4}
              className="rc-label"
              fill={playerColor(s.name)}
            >
              {s.name} · {s.total}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
