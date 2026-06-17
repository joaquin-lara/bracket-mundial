'use client';

import { useEffect, useState } from 'react';
import Flag from './Flag';
import { byCode, type TeamRating } from '@/lib/ml/teams';

interface Meeting { date: string; h: string; a: string; hs: number; as: number; t: string }
interface Pair {
  a: string; b: string;
  played: number; winsA: number; winsB: number; draws: number; gfA: number; gfB: number;
  recent: Meeting[];
}

// Fetch the pre-computed history once per page load and share it across renders.
let cache: Promise<Record<string, Pair>> | null = null;
function loadH2H(): Promise<Record<string, Pair>> {
  if (!cache) cache = fetch('/h2h.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return cache;
}

/** All-time and recent head-to-head record between two teams (codes). */
export default function H2HHistory({ home, away }: { home: TeamRating; away: TeamRating }) {
  const [data, setData] = useState<Record<string, Pair> | null>(null);
  // How many of the most recent meetings feed the bar (clamped to availability).
  const [windowN, setWindowN] = useState(30);
  useEffect(() => { loadH2H().then(setData); }, []);

  const [x, y] = [home.code, away.code].sort();
  const pair = data?.[`${x}|${y}`];

  if (!data) return null;
  if (!pair || pair.played === 0) {
    return (
      <div style={{ marginTop: 22 }}>
        <div style={{ fontWeight: 800, marginBottom: 2, color: 'var(--cream)' }}>Head-to-head</div>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>No recorded meetings between {home.name} and {away.name}.</div>
      </div>
    );
  }

  const maxN = pair.recent.length;
  const n = Math.min(windowN, maxN);
  const meetings = pair.recent.slice(0, n); // newest first

  // Tally the selected window, oriented to home (left) vs away (right).
  let homeWins = 0, awayWins = 0, draws = 0, homeGf = 0, awayGf = 0;
  for (const m of meetings) {
    const hg = m.h === home.code ? m.hs : m.as;
    const ag = m.h === home.code ? m.as : m.hs;
    homeGf += hg; awayGf += ag;
    if (hg > ag) homeWins++; else if (hg < ag) awayWins++; else draws++;
  }
  const total = n || 1;

  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ fontWeight: 800, marginBottom: 2, color: 'var(--cream)' }}>Head-to-head</div>
      <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10 }}>
        {pair.played} meetings on record · showing the last {n}{n === maxN ? '' : ` of ${maxN}`} · {homeGf}–{awayGf} goals.
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, fontWeight: 800, marginBottom: 5, color: 'var(--cream)' }}>
        <span>{home.name} {homeWins}</span>
        <span style={{ color: 'var(--dim)' }}>{draws} draws</span>
        <span>{awayWins} {away.name}</span>
      </div>
      <div style={{ display: 'flex', height: 11, borderRadius: 6, overflow: 'hidden', background: 'rgba(244,241,232,0.1)' }}>
        <span style={{ width: `${(homeWins / total) * 100}%`, background: 'rgb(52,211,153)' }} />
        <span style={{ width: `${(draws / total) * 100}%`, background: 'rgba(244,241,232,0.35)' }} />
        <span style={{ width: `${(awayWins / total) * 100}%`, background: 'rgb(230,179,55)' }} />
      </div>

      {maxN > 3 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
          <span style={{ fontSize: 12, color: 'var(--dim)', whiteSpace: 'nowrap' }}>Meetings on bar</span>
          <input
            type="range" min={3} max={maxN} value={n}
            onChange={(e) => setWindowN(Number(e.target.value))}
            aria-label="Number of recent meetings to include"
            style={{ flex: 1, accentColor: 'rgb(230,179,55)' }}
          />
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--gold)', width: 24, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{n}</span>
        </div>
      )}

      <div style={{ marginTop: 14, fontSize: 12, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Recent meetings</div>
      <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column' }}>
        {meetings.map((m, i) => {
          const ht = byCode(m.h); const at = byCode(m.a);
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, padding: '5px 0', borderTop: '1px solid var(--line)', color: 'var(--cream)' }}>
              <span style={{ width: 42, color: 'var(--dim)', fontVariantNumeric: 'tabular-nums' }}>{m.date.slice(0, 4)}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 1, justifyContent: 'flex-end' }}>
                {ht?.name ?? m.h} <Flag code={m.h} name={ht?.name ?? m.h} />
              </span>
              <strong style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--gold)' }}>{m.hs}–{m.as}</strong>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 1 }}>
                <Flag code={m.a} name={at?.name ?? m.a} /> {at?.name ?? m.a}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
