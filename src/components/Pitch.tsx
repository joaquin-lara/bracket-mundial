import type { PitchPlayer } from '@/lib/lineupLayout';

const W = 200, H = 300, PAD = 16;

/** Presentational vertical pitch: places dots from normalised player coords. */
export default function Pitch({ players, accent, formation }: { players: PitchPlayer[]; accent: string; formation: string }) {
  const px = (nx: number) => PAD + nx * (W - 2 * PAD);
  const py = (ny: number) => (H - PAD - 12) - ny * (H - 2 * PAD - 30);
  const line = 'rgba(244,241,232,0.25)';

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${formation} formation`}
      style={{ maxWidth: 220, background: 'rgba(11,95,58,0.55)', borderRadius: 8, border: '1px solid var(--line)' }}>
      <rect x={PAD / 2} y={PAD / 2} width={W - PAD} height={H - PAD} fill="none" stroke={line} strokeWidth={1} />
      <line x1={PAD / 2} y1={H / 2} x2={W - PAD / 2} y2={H / 2} stroke={line} strokeWidth={1} />
      <circle cx={W / 2} cy={H / 2} r={26} fill="none" stroke={line} strokeWidth={1} />
      <rect x={W / 2 - 30} y={H - PAD / 2 - 34} width={60} height={34} fill="none" stroke={line} strokeWidth={1} />
      <rect x={W / 2 - 30} y={PAD / 2} width={60} height={34} fill="none" stroke={line} strokeWidth={1} />
      {players.map((p, i) => (
        <g key={i}>
          <circle cx={px(p.nx)} cy={py(p.ny)} r={8} fill={p.gk ? 'var(--gold)' : accent} stroke="#06281c" strokeWidth={1} />
          <text x={px(p.nx)} y={py(p.ny) + 18} fontSize={7.5} fontWeight={600} fill="var(--cream)" textAnchor="middle">{p.label}</text>
        </g>
      ))}
    </svg>
  );
}
