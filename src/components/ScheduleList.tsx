'use client';

import Flag from './Flag';
import { stageLabel, type Match } from '@/lib/types';

/** Read-only fixture list grouped by the viewer's local calendar day. */
export default function ScheduleList({ matches }: { matches: Match[] }) {
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
          <div className="sched-card">
            {dayMatches.map((m) => {
              const finished = m.status === 'FINISHED';
              const live = m.status === 'IN_PLAY' || m.status === 'PAUSED';
              const time = new Date(m.kickoff).toLocaleTimeString(undefined, {
                hour: '2-digit',
                minute: '2-digit',
              });
              return (
                <div className="sched-row" key={m.id}>
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
                    {live ? 'Live' : finished ? 'FT · ' + stageLabel(m.stage, m.group_name) : stageLabel(m.stage, m.group_name)}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}
