'use client';

import { useEffect, useState } from 'react';
import { submitPrediction } from '@/app/actions';
import Flag from './Flag';
import VenueInfo from './VenueInfo';
import ConfirmedLineups from './ConfirmedLineups';
import TransitionLink from './TransitionLink';
import { lockTime, stageLabel, type Match, type Prediction, type RevealedPick } from '@/lib/types';

interface Props {
  match: Match;
  prediction: Prediction | null;
  revealedPicks?: RevealedPick[];
  /** Guest view: no score inputs, no Save button. */
  readOnly?: boolean;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function formatCountdown(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `Locks in ${d}d ${h}h`;
  if (h > 0) return `Locks in ${h}h ${m}m`;
  if (m > 0) return `Locks in ${m}m ${sec}s`;
  return `Locks in ${sec}s`;
}

export default function MatchCard({ match, prediction, revealedPicks, readOnly }: Props) {
  const lockAt = lockTime(match.kickoff);
  const finished = match.status === 'FINISHED';
  const live = match.status === 'IN_PLAY' || match.status === 'PAUSED';
  const started = ['IN_PLAY', 'PAUSED', 'FINISHED'].includes(match.status);
  const teamsTbd = match.home_team === 'TBD' || match.away_team === 'TBD';

  const now = useNow(!started && Date.now() < lockAt + 5000);
  const locked = started || now >= lockAt;

  const [home, setHome] = useState(prediction ? String(prediction.pred_home) : '');
  const [away, setAway] = useState(prediction ? String(prediction.pred_away) : '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setSaving(true);
    setMsg(null);
    const result = await submitPrediction(match.id, Number(home), Number(away));
    setSaving(false);
    setMsg(result.ok ? { ok: true, text: 'Saved' } : { ok: false, text: result.error ?? 'Error' });
  }

  const kickoffLabel = new Date(match.kickoff).toLocaleString(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  const dirty =
    prediction == null
      ? home !== '' && away !== ''
      : home !== String(prediction.pred_home) || away !== String(prediction.pred_away);

  return (
    <div className="match-card">
      <div className="match-meta">
        <span>{stageLabel(match.stage, match.group_name)}</span>
        <span>
          {finished ? (
            <span className="badge-ft">FT</span>
          ) : live ? (
            <span className="badge-live">LIVE</span>
          ) : (
            kickoffLabel
          )}
        </span>
      </div>

      <div className="match-row">
        <div className="team">
          <Flag code={match.home_code} name={match.home_team} />
          <span>{match.home_team}</span>
        </div>

        <div className="match-center">
          {started ? (
            <div className="final-score">
              {match.home_score ?? '–'} : {match.away_score ?? '–'}
            </div>
          ) : readOnly ? (
            <div className="final-score muted-score">vs</div>
          ) : (
            <div className="score-inputs">
              <input
                type="number"
                min={0}
                max={20}
                inputMode="numeric"
                value={home}
                disabled={locked || teamsTbd}
                onChange={(e) => setHome(e.target.value)}
                aria-label={`${match.home_team} goals`}
              />
              <span className="dash">:</span>
              <input
                type="number"
                min={0}
                max={20}
                inputMode="numeric"
                value={away}
                disabled={locked || teamsTbd}
                onChange={(e) => setAway(e.target.value)}
                aria-label={`${match.away_team} goals`}
              />
            </div>
          )}
        </div>

        <div className="team away">
          <span>{match.away_team}</span>
          <Flag code={match.away_code} name={match.away_team} />
        </div>
      </div>

      <VenueInfo venue={match.venue} />

      {match.lineups ? (
        <ConfirmedLineups lineups={match.lineups} leftCode={match.home_code} />
      ) : (
        !teamsTbd &&
        match.home_code &&
        match.away_code &&
        match.status !== 'FINISHED' &&
        lockAt - now < 65 * 60 * 1000 && (
          <div className="lineup-wait">Confirmed lineups expected ~40 min before kickoff.</div>
        )
      )}

      <div className="match-footer">
        {teamsTbd && !started ? (
          <span className="locked-tag">Teams TBD — opens when both are decided</span>
        ) : locked ? (
          <span className="locked-tag">
            {started
              ? prediction
                ? `Your pick: ${prediction.pred_home}-${prediction.pred_away}`
                : 'No prediction'
              : 'Locked'}
          </span>
        ) : (
          <span className={`countdown${now >= lockAt - 30 * 60 * 1000 ? ' soon' : ''}`}>
            {formatCountdown(lockAt - now)}
          </span>
        )}

        {msg && <span className={msg.ok ? 'msg-ok' : 'msg-err'}>{msg.text}</span>}

        {finished && prediction && prediction.points != null && (
          <span className={`points-badge points-${prediction.points}`}>
            {prediction.points} pt{prediction.points === 1 ? '' : 's'}
          </span>
        )}

        {!teamsTbd && match.home_code && match.away_code && (
          <TransitionLink
            className="ml-link-btn"
            href={`/predictor?home=${match.home_code}&away=${match.away_code}`}
            title={`Open ${match.home_team} vs ${match.away_team} in the ML Predictor`}
          >
            ML Prediction
          </TransitionLink>
        )}

        {!locked && !teamsTbd && !readOnly && (
          <button
            className="save-btn"
            onClick={save}
            disabled={saving || home === '' || away === '' || !dirty}
          >
            {saving ? 'Saving…' : prediction ? 'Update' : 'Save'}
          </button>
        )}
      </div>

      {started && revealedPicks && revealedPicks.length > 0 && (
        <div className="picks">
          <div className="picks-title">Everyone&apos;s picks</div>
          {revealedPicks.map((p) => (
            <div className="picks-row" key={p.display_name}>
              <span>{p.display_name}</span>
              <span>
                {p.pred_home}-{p.pred_away}
                {p.points != null && (
                  <>
                    {' '}
                    <span className={`points-badge points-${p.points}`}>{p.points}</span>
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
