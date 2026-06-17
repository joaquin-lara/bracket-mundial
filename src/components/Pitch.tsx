import type { PitchPlayer } from '@/lib/lineupLayout';

// Landscape pitch: GK on the left, attack to the right. Short + wide so two of
// them stack without eating the whole phone screen.
const W = 320, H = 196, PAD = 16;

/** Presentational pitch: places dots from normalised player coords. */
export default function Pitch({ players, accent, formation }: { players: PitchPlayer[]; accent: string; formation: string }) {
  const px = (ny: number) => PAD + ny * (W - 2 * PAD); // 0 = own goal/GK (left), 1 = attack (right)
  const py = (nx: number) => 22 + nx * (H - 48); // spread a line across the height
  const line = 'rgba(244,241,232,0.25)';

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${formation} formation`}
      style={{ maxWidth: 340, background: 'rgba(11,95,58,0.55)', borderRadius: 8, border: '1px solid var(--line)' }}>
      <rect x={PAD / 2} y={PAD / 2} width={W - PAD} height={H - PAD} fill="none" stroke={line} strokeWidth={1} />
      <line x1={W / 2} y1={PAD / 2} x2={W / 2} y2={H - PAD / 2} stroke={line} strokeWidth={1} />
      <circle cx={W / 2} cy={H / 2} r={24} fill="none" stroke={line} strokeWidth={1} />
      <rect x={PAD / 2} y={H / 2 - 34} width={40} height={68} fill="none" stroke={line} strokeWidth={1} />
      <rect x={W - PAD / 2 - 40} y={H / 2 - 34} width={40} height={68} fill="none" stroke={line} strokeWidth={1} />
      {players.map((p, i) => (
        <g key={i}>
          <circle cx={px(p.ny)} cy={py(p.nx)} r={p.gk ? 9 : 8} fill={accent} stroke="#06281c" strokeWidth={p.gk ? 1.5 : 1} />
          {p.gk && (
            <text x={px(p.ny)} y={py(p.nx) + 3.4} fontSize={10} textAnchor="middle">🧤</text>
          )}
          <text x={px(p.ny)} y={py(p.nx) + 14} fontSize={7.5} fontWeight={600} fill="var(--cream)" textAnchor="middle">{p.label}</text>
        </g>
      ))}
    </svg>
  );
}
