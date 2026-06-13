'use client';

import { useState } from 'react';
import MatchCard from './MatchCard';
import type { Match, Prediction, RevealedPick } from '@/lib/types';

interface Props {
  matches: Match[];
  predictions: Record<number, Prediction>;
  revealedPicks?: Record<number, RevealedPick[]>;
  /** Show an Upcoming/Past toggle (past = finished games, most recent first). */
  split?: boolean;
  /** Guest view: show fixtures but hide the score inputs and Save button. */
  readOnly?: boolean;
}

function groupByDay(matches: Match[]) {
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
  return groups;
}

/** Groups matches by the viewer's local calendar day. */
export default function MatchList({ matches, predictions, revealedPicks, split, readOnly }: Props) {
  const [view, setView] = useState<'upcoming' | 'past'>('upcoming');

  const upcoming = split ? matches.filter((m) => m.status !== 'FINISHED') : matches;
  const past = split ? matches.filter((m) => m.status === 'FINISHED').reverse() : [];
  const shown = split && view === 'past' ? past : upcoming;

  const groups = groupByDay(shown);

  return (
    <>
      {split && (
        <div className="seg-toggle">
          <button
            className={view === 'upcoming' ? 'active' : ''}
            onClick={() => setView('upcoming')}
          >
            Upcoming ({upcoming.length})
          </button>
          <button className={view === 'past' ? 'active' : ''} onClick={() => setView('past')}>
            Past ({past.length})
          </button>
        </div>
      )}

      {shown.length === 0 && split ? (
        <p className="empty">
          {view === 'upcoming' ? 'No upcoming games left.' : 'No games played yet.'}
        </p>
      ) : (
        [...groups.entries()].map(([day, dayMatches]) => (
          <section key={day}>
            <div className="day-header">{day}</div>
            {dayMatches.map((m) => (
              <MatchCard
                key={m.id}
                match={m}
                prediction={predictions[m.id] ?? null}
                revealedPicks={revealedPicks?.[m.id]}
                readOnly={readOnly}
              />
            ))}
          </section>
        ))
      )}
    </>
  );
}
