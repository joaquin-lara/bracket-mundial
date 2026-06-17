'use client';

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Flag from './Flag';
import TeamCombobox from './TeamCombobox';
import ScoreGrid from './ScoreGrid';
import TeamRadar from './TeamRadar';
import H2HHistory from './H2HHistory';
import Lineup from './Lineup';
import ChartTag from './ChartTag';
import { TEAMS, byCode } from '@/lib/ml/teams';
import { predict, pct } from '@/lib/ml/model';

/** Validate a ?home= / ?away= code from the URL, or null if not one of the 48. */
function validCode(raw: string | null): string | null {
  const c = (raw ?? '').toUpperCase();
  return byCode(c) ? c : null;
}

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
  const params = useSearchParams();
  const presetHome = validCode(params.get('home')) ?? 'ARG';
  let presetAway = validCode(params.get('away')) ?? (presetHome === 'BRA' ? 'ARG' : 'BRA');
  if (presetAway === presetHome) {
    presetAway = TEAMS.find((t) => t.code !== presetHome)!.code;
  }

  const [home, setHome] = useState(presetHome);
  const [away, setAway] = useState(presetAway);
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
          <TeamCombobox value={home} onChange={setHome} exclude={away} label="Team A" />
        </label>

        <button className="ml-swap" onClick={swap} aria-label="Swap teams" type="button">
          ⇄
        </button>

        <label className="ml-pick">
          <span className="ml-pick-label">Team B</span>
          <TeamCombobox value={away} onChange={setAway} exclude={home} label="Team B" />
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
        <div style={{ fontWeight: 800, color: 'var(--cream)', marginBottom: 2 }}>
          Match prediction<ChartTag kind="prediction" />
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 12 }}>
          Win / draw / win odds from the model — a blend of Dixon-Coles form, Elo strength and FIFA squad talent.
        </div>
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
          <span className="ml-scorelines-label">Most likely scorelines<ChartTag kind="prediction" /></span>
          <span className="ml-scorelines-hint">
            Predicted by the model. Chance of each exact final score, {H.name} listed first.
          </span>
          <div className="ml-score-grid">
            {result.topScores.map((s, i) => (
              <div className="ml-score-cell" key={i}>
                <span className="ml-score-num">
                  <Flag code={H.code} name={H.name} />
                  {s.home}–{s.away}
                  <Flag code={A.code} name={A.name} />
                </span>
                <span className="ml-score-prob">{pct(s.prob)}</span>
              </div>
            ))}
          </div>
        </div>

        <ScoreGrid grid={result.scoreGrid} home={H} away={A} />
        <TeamRadar home={H} away={A} />
        <H2HHistory home={H} away={A} />

        <div style={{ marginTop: 22 }}>
          <div style={{ fontWeight: 800, marginBottom: 2, color: 'var(--cream)', textAlign: 'center' }}>Projected lineups<ChartTag kind="history" /></div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10, textAlign: 'center' }}>
            Not a prediction — each team&apos;s most recent known formation and XI from match records. Positions on the pitch are approximate.
          </div>
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Lineup team={H} accent="rgb(52,211,153)" />
            <Lineup team={A} accent="rgb(230,179,55)" />
          </div>
        </div>
      </div>
    </div>
  );
}
