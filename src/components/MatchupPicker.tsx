'use client';

import { useMemo, useState } from 'react';
import Flag from './Flag';
import { TEAMS } from '@/lib/ml/teams';
import { predict, pct } from '@/lib/ml/model';

const OPTIONS = TEAMS.map((t) => ({ code: t.code, name: t.name }));

function ProbBar({ home, draw, away }: { home: number; draw: number; away: number }) {
  return (
    <div className="ml-bar" role="img" aria-label={`Home ${pct(home)}, draw ${pct(draw)}, away ${pct(away)}`}>
      <span className="ml-bar-h" style={{ width: `${home * 100}%` }} />
      <span className="ml-bar-d" style={{ width: `${draw * 100}%` }} />
      <span className="ml-bar-a" style={{ width: `${away * 100}%` }} />
    </div>
  );
}

export default function MatchupPicker() {
  const [home, setHome] = useState('ARG');
  const [away, setAway] = useState('BRA');
  const [neutral, setNeutral] = useState(true);

  const result = useMemo(
    () => predict({ home, away, neutral }),
    [home, away, neutral]
  );

  const swap = () => {
    setHome(away);
    setAway(home);
  };

  if (!result) return null;
  const { home: H, away: A } = result;

  return (
    <div className="ml-picker">
      <div className="ml-pick-row">
        <label className="ml-pick">
          <span className="ml-pick-label">Team A</span>
          <div className="ml-select-wrap">
            <Flag code={H.code} name={H.name} />
            <select value={home} onChange={(e) => setHome(e.target.value)} aria-label="Team A">
              {OPTIONS.map((o) => (
                <option key={o.code} value={o.code} disabled={o.code === away}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        </label>

        <button className="ml-swap" onClick={swap} aria-label="Swap teams" type="button">
          ⇄
        </button>

        <label className="ml-pick">
          <span className="ml-pick-label">Team B</span>
          <div className="ml-select-wrap">
            <Flag code={A.code} name={A.name} />
            <select value={away} onChange={(e) => setAway(e.target.value)} aria-label="Team B">
              {OPTIONS.map((o) => (
                <option key={o.code} value={o.code} disabled={o.code === home}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        </label>
      </div>

      <label className="ml-neutral">
        <input
          type="checkbox"
          checked={neutral}
          onChange={(e) => setNeutral(e.target.checked)}
        />
        Neutral venue (off = Team A gets home advantage)
      </label>

      <div className="ml-result">
        <div className="ml-prob-head">
          <span className="ml-prob-team">
            {H.name} win
            <strong>{pct(result.probHome)}</strong>
          </span>
          <span className="ml-prob-team ml-prob-draw">
            Draw
            <strong>{pct(result.probDraw)}</strong>
          </span>
          <span className="ml-prob-team ml-prob-right">
            {A.name} win
            <strong>{pct(result.probAway)}</strong>
          </span>
        </div>
        <ProbBar home={result.probHome} draw={result.probDraw} away={result.probAway} />

        <div className="ml-stats">
          <div className="ml-stat">
            <span className="ml-stat-k">Strength (Elo)</span>
            <span className="ml-stat-v">
              {H.elo.toFixed(0)} vs {A.elo.toFixed(0)}
            </span>
          </div>
          <div className="ml-stat">
            <span className="ml-stat-k">Expected goals</span>
            <span className="ml-stat-v">
              {result.lambdaHome.toFixed(2)} – {result.lambdaAway.toFixed(2)}
            </span>
          </div>
          <div className="ml-stat">
            <span className="ml-stat-k">Most likely score</span>
            <span className="ml-stat-v">
              {result.mostLikelyScore.home}–{result.mostLikelyScore.away}{' '}
              <em>({pct(result.mostLikelyScore.prob)})</em>
            </span>
          </div>
        </div>

        <div className="ml-scorelines">
          <span className="ml-scorelines-label">Most likely scorelines</span>
          <span className="ml-scorelines-hint">
            Chance of each exact final score. {H.name} listed first.
          </span>
          <div className="ml-score-grid">
            {result.topScores.map((s, i) => (
              <div className="ml-score-cell" key={i}>
                <span className="ml-score-num">
                  {s.home}–{s.away}
                </span>
                <span className="ml-score-prob">{pct(s.prob)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
