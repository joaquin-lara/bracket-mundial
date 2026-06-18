'use client';

import Flag from './Flag';
import { stageLabel, type Match } from '@/lib/types';
import { venueLabel } from '@/lib/venues';

export default function TodayGames({ matches }: { matches: Match[] }) {
  const localToday = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time

  const todayGames = matches.filter((m) => {
    const kickoffLocal = new Date(m.kickoff).toLocaleDateString('en-CA');
    return kickoffLocal === localToday;
  });

  if (todayGames.length === 0) return null;

  return (
    <section className="today-games">
      <div className="contenders-head">
        <span className="contenders-label">Today&apos;s Games</span>
        <div className="contenders-line" />
      </div>
      <div className="sched-card">
        {todayGames.map((m) => {
          const finished = m.status === 'FINISHED';
          const live = m.status === 'IN_PLAY' || m.status === 'PAUSED';
          const time = new Date(m.kickoff).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
          return (
            <div className="sched-entry" key={m.id}>
              <div className="sched-row">
                <div className="sched-side left">
                  <span className="sched-time">{time}</span>
                  <span className="sched-team home">
                    <span className="sched-name">{m.home_team}</span>
                    <Flag code={m.home_code} name={m.home_team} />
                  </span>
                </div>
                <span className={`sched-mid${live ? ' live' : ''}`}>
                  {finished || live ? `${m.home_score ?? ''} – ${m.away_score ?? ''}` : 'vs'}
                </span>
                <div className="sched-side right">
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
              {venueLabel(m.venue) && <div className="sched-venue">{venueLabel(m.venue)}</div>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
