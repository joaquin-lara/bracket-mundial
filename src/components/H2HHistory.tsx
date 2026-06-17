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
  useEffect(() => { loadH2H().then(setData); }, []);

  const [x, y] = [home.code, away.code].sort();
  const pair = data?.[`${x}|${y}`];

  if (!data) return null;
  if (!pair || pair.played === 0) {
    return (
      <div style={{ marginTop: 18 }}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>Head-to-head</div>
        <div style={{ fontSize: 13, color: '#667' }}>No recorded meetings between {home.name} and {away.name}.</div>
      </div>
    );
  }

  // Orient the aggregate to home (left) vs away (right).
  const homeIsA = home.code === x;
  const homeWins = homeIsA ? pair.winsA : pair.winsB;
  const awayWins = homeIsA ? pair.winsB : pair.winsA;
  const homeGf = homeIsA ? pair.gfA : pair.gfB;
  const awayGf = homeIsA ? pair.gfB : pair.gfA;
  const total = pair.played || 1;

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontWeight: 700, marginBottom: 2 }}>Head-to-head</div>
      <div style={{ fontSize: 12, color: '#667', marginBottom: 8 }}>
        {pair.played} meetings on record · {homeGf}–{awayGf} on aggregate goals.
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
        <span>{home.name} {homeWins}</span>
        <span style={{ color: '#667' }}>{pair.draws} draws</span>
        <span>{awayWins} {away.name}</span>
      </div>
      <div style={{ display: 'flex', height: 10, borderRadius: 6, overflow: 'hidden', background: '#eee' }}>
        <span style={{ width: `${(homeWins / total) * 100}%`, background: 'rgb(11,95,58)' }} />
        <span style={{ width: `${(pair.draws / total) * 100}%`, background: 'rgb(150,150,150)' }} />
        <span style={{ width: `${(awayWins / total) * 100}%`, background: 'rgb(193,140,30)' }} />
      </div>

      <div style={{ marginTop: 12, fontSize: 12, color: '#667' }}>Recent meetings</div>
      <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {pair.recent.map((m, i) => {
          const ht = byCode(m.h); const at = byCode(m.a);
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '3px 0' }}>
              <span style={{ width: 64, color: '#889', fontVariantNumeric: 'tabular-nums' }}>{m.date.slice(0, 4)}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 1, justifyContent: 'flex-end' }}>
                {ht?.name ?? m.h} <Flag code={m.h} name={ht?.name ?? m.h} />
              </span>
              <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{m.hs}–{m.as}</strong>
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
