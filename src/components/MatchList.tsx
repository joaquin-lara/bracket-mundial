'use client';

import MatchCard from './MatchCard';
import type { Match, Prediction, RevealedPick } from '@/lib/types';

interface Props {
  matches: Match[];
  predictions: Record<number, Prediction>;
  revealedPicks?: Record<number, RevealedPick[]>;
}

/** Groups matches by the viewer's local calendar day. */
export default function MatchList({ matches, predictions, revealedPicks }: Props) {
  const groups = new Map<string, Match[]>();
  for (const m of matches) {
    const day = new Date(m.kickoff).toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day)!.push(m);
  }

  return (
    <>
      {[...groups.entries()].map(([day, dayMatches]) => (
        <section key={day}>
          <div className="day-header">{day}</div>
          {dayMatches.map((m) => (
            <MatchCard
              key={m.id}
              match={m}
              prediction={predictions[m.id] ?? null}
              revealedPicks={revealedPicks?.[m.id]}
            />
          ))}
        </section>
      ))}
    </>
  );
}
