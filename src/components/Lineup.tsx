'use client';

import { useEffect, useState } from 'react';
import type { TeamRating } from '@/lib/ml/teams';

interface TeamLineup { code: string; date: string; formation: string; starters: { num: string; name: string }[] }

// Fetch the pre-computed lineups once per page load and share across renders.
let cache: Promise<Record<string, TeamLineup>> | null = null;
function loadLineups(): Promise<Record<string, TeamLineup>> {
  if (!cache) cache = fetch('/lineups.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return cache;
}

const W = 200, H = 300, PAD = 16;

function lastName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(' ') : name;
}

/**
 * Short pitch labels: surname only, but when two starters share a surname (e.g.
 * the two Martínez / Hernández), prefix the first initial so they're distinct.
 */
function shortLabels(names: string[]): string[] {
  const surnames = names.map(lastName);
  const counts = new Map<string, number>();
  for (const s of surnames) counts.set(s, (counts.get(s) ?? 0) + 1);
  return names.map((name, i) => {
    const sur = surnames[i];
    if ((counts.get(sur) ?? 0) <= 1) return sur;
    const first = name.trim().split(/\s+/)[0];
    return `${first[0]}. ${sur}`;
  });
}

/** A starting XI laid out on a vertical pitch in its formation (attacking up). */
function Pitch({ lu, accent }: { lu: TeamLineup; accent: string }) {
  const lines = lu.formation.split('-').map(Number).filter((k) => k > 0);
  const rows = [1, ...lines]; // GK + outfield lines, defence -> attack
  const R = rows.length;
  const labels = shortLabels(lu.starters.map((s) => s.name));

  // Assign starters in listed order: GK first, then each line filled L->R.
  const dots: { x: number; y: number; label: string; gk: boolean }[] = [];
  let idx = 0;
  rows.forEach((k, r) => {
    const y = (H - PAD - 12) - (R > 1 ? (r * (H - 2 * PAD - 30)) / (R - 1) : 0);
    for (let i = 0; i < k; i++) {
      const x = PAD + ((i + 1) * (W - 2 * PAD)) / (k + 1);
      dots.push({ x, y, label: labels[idx++] ?? '', gk: r === 0 });
    }
  });

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${lu.formation} formation`}
      style={{ maxWidth: 220, background: 'rgba(11,95,58,0.55)', borderRadius: 8, border: '1px solid var(--line)' }}>
      {/* pitch markings */}
      <rect x={PAD / 2} y={PAD / 2} width={W - PAD} height={H - PAD} fill="none" stroke="rgba(244,241,232,0.25)" strokeWidth={1} />
      <line x1={PAD / 2} y1={H / 2} x2={W - PAD / 2} y2={H / 2} stroke="rgba(244,241,232,0.25)" strokeWidth={1} />
      <circle cx={W / 2} cy={H / 2} r={26} fill="none" stroke="rgba(244,241,232,0.25)" strokeWidth={1} />
      <rect x={W / 2 - 30} y={H - PAD / 2 - 34} width={60} height={34} fill="none" stroke="rgba(244,241,232,0.25)" strokeWidth={1} />
      <rect x={W / 2 - 30} y={PAD / 2} width={60} height={34} fill="none" stroke="rgba(244,241,232,0.25)" strokeWidth={1} />
      {dots.map((d, i) => (
        <g key={i}>
          <circle cx={d.x} cy={d.y} r={8} fill={d.gk ? 'var(--gold)' : accent} stroke="#06281c" strokeWidth={1} />
          <text x={d.x} y={d.y + 18} fontSize={7.5} fontWeight={600} fill="var(--cream)" textAnchor="middle">{d.label}</text>
        </g>
      ))}
    </svg>
  );
}

/** Projected lineup for a team: most recent known formation + XI, on a pitch. */
export default function Lineup({ team, accent }: { team: TeamRating; accent: string }) {
  const [data, setData] = useState<Record<string, TeamLineup> | null>(null);
  useEffect(() => { loadLineups().then(setData); }, []);
  if (!data) return null;

  const lu = data[team.code];
  return (
    <div style={{ flex: '1 1 200px', minWidth: 180, textAlign: 'center' }}>
      <div style={{ fontWeight: 700, color: 'var(--cream)', fontSize: 13.5 }}>{team.name}</div>
      {lu ? (
        <>
          <div style={{ fontSize: 12, color: 'var(--gold)', marginBottom: 6, fontWeight: 700 }}>{lu.formation}</div>
          <Pitch lu={lu} accent={accent} />
          <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 4 }}>last seen {lu.date}</div>
        </>
      ) : (
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 30 }}>No recent lineup on record.</div>
      )}
    </div>
  );
}
