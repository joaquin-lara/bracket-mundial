'use client';

import { useEffect, useState } from 'react';
import type { TeamRating } from '@/lib/ml/teams';
import Pitch from './Pitch';
import { fromFormation } from '@/lib/lineupLayout';

interface TeamLineup { code: string; date: string; formation: string; starters: { num: string; name: string }[] }

// Fetch the pre-computed projected lineups once per page load and share them.
let cache: Promise<Record<string, TeamLineup>> | null = null;
function loadLineups(): Promise<Record<string, TeamLineup>> {
  if (!cache) cache = fetch('/lineups.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return cache;
}

/** Projected lineup for a team: most recent known formation + XI (fbref). */
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
          <Pitch players={fromFormation(lu.formation, lu.starters.map((s) => s.name))} accent={accent} formation={lu.formation} />
          <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 4 }}>last seen {lu.date}</div>
        </>
      ) : (
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 30 }}>No recent lineup on record.</div>
      )}
    </div>
  );
}
