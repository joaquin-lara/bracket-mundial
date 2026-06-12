'use client';

import { useState } from 'react';
import Flag from './Flag';
import { stageLabel, type Match } from '@/lib/types';

type View = 'upcoming' | 'past';

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

function Row({ m }: { m: Match }) {
  const finished = m.status === 'FINISHED';
  const live = m.status === 'IN_PLAY' || m.status === 'PAUSED';
  const time = new Date(m.kickoff).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <div className="sched-entry">
      <div className="sched-row">
        <span className="sched-time">{time}</span>
        <span className="sched-team home">
          <span className="sched-name">{m.home_team}</span>
          <Flag code={m.home_code} name={m.home_team} />
        </span>
        <span className={`sched-mid${live ? ' live' : ''}`}>
          {finished || live ? `${m.home_score ?? ''} – ${m.away_score ?? ''}` : 'vs'}
        </span>
        <span className="sched-team">
          <Flag code={m.away_code} name={m.away_team} />
          <span className="sched-name">{m.away_team}</span>
        </span>
        <span className="sched-stage">
          {live ? (
            <span className="badge-live">LIVE</span>
          ) : finished ? (
            <>FT · {stageLabel(m.stage, m.group_name)}</>
          ) : (
            stageLabel(m.stage, m.group_name)
          )}
        </span>
      </div>
    </div>
  );
}

/** Read-only fixture list split into upcoming and past games. */
export default function ScheduleList({ matches }: { matches: Match[] }) {
  const [view, setView] = useState<View>('upcoming');

  // Finished games are "past"; everything else (incl. live) is "upcoming".
  const upcoming = matches.filter((m) => m.status !== 'FINISHED');
  const past = matches.filter((m) => m.status === 'FINISHED').reverse(); // most recent first

  const shown = view === 'upcoming' ? upcoming : past;
  const groups = groupByDay(shown);

  return (
    <>
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

      {shown.length === 0 ? (
        <p className="empty">
          {view === 'upcoming' ? 'No upcoming games left.' : 'No games played yet.'}
        </p>
      ) : (
        [...groups.entries()].map(([day, dayMatches]) => (
          <section key={day}>
            <div className="day-header">{day}</div>
            <div className="sched-card">
              {dayMatches.map((m) => (
                <Row m={m} key={m.id} />
              ))}
            </div>
          </section>
        ))
      )}
    </>
  );
}
