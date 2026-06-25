import type { Metadata } from 'next';
import { Suspense } from 'react';
import './predictor.css';
import Flag from '@/components/Flag';
import ChartTag from '@/components/ChartTag';
import MatchupPicker, { type LastLineup } from '@/components/MatchupPicker';
import { MarketOddsProvider, MarketOddsRow } from '@/components/MarketOdds';
import { ensureFreshScores } from '@/lib/autoSync';
import { createClient } from '@/lib/supabase/server';
import type { Match, MatchLineups } from '@/lib/types';
import { stageLabel } from '@/lib/types';
import { predict, pct } from '@/lib/ml/model';
import { DATASET, MODEL, lookup, TEAMS } from '@/lib/ml/teams';

export const metadata: Metadata = { title: 'ML Predictor' };
export const dynamic = 'force-dynamic';

function MiniBar({ h, d, a }: { h: number; d: number; a: number }) {
  return (
    <div className="ml-bar ml-bar-sm">
      <span className="ml-bar-h" style={{ width: `${h * 100}%` }} />
      <span className="ml-bar-d" style={{ width: `${d * 100}%` }} />
      <span className="ml-bar-a" style={{ width: `${a * 100}%` }} />
    </div>
  );
}

export default async function PredictorPage() {
  await ensureFreshScores();
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('matches')
    .select('*')
    .order('kickoff', { ascending: true });
  const matches = (data ?? []) as Match[];

  // Real confirmed XIs keyed by sorted team-code pair, for the matchup picker.
  const confirmedByPair: Record<string, MatchLineups> = {};
  // Each team's XI from their most recent World Cup match we have on record.
  const lastRaw: Record<string, { team: MatchLineups['home']; kickoff: string; opp: string }> = {};
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const consider = (code: string, team: MatchLineups['home'], kickoff: string, opp: string) => {
    const prev = lastRaw[code];
    if (!prev || kickoff > prev.kickoff) lastRaw[code] = { team, kickoff, opp };
  };
  for (const m of matches) {
    if (!m.lineups) continue;
    if (m.home_code && m.away_code) {
      confirmedByPair[[m.home_code, m.away_code].slice().sort().join('|')] = m.lineups;
    }
    if (m.home_code) consider(m.home_code, m.lineups.home, m.kickoff, m.away_team);
    if (m.away_code) consider(m.away_code, m.lineups.away, m.kickoff, m.home_team);
  }
  const lastLineupByTeam: Record<string, LastLineup> = {};
  for (const [code, r] of Object.entries(lastRaw)) {
    lastLineupByTeam[code] = { team: r.team, caption: `vs ${r.opp} · ${fmtDate(r.kickoff)}` };
  }

  // Default the picker to the current/most-recent match: a live game if any, else
  // the latest one already kicked off, else the soonest upcoming. Fast to read
  // your ML mid-match without scrolling.
  const now = Date.now();
  const rateable = matches.filter((m) => m.home_code && m.away_code && lookup(m.home_code) && lookup(m.away_code));
  const live = rateable.filter((m) => m.status === 'IN_PLAY' || m.status === 'PAUSED');
  const started = rateable.filter((m) => Date.parse(m.kickoff) <= now);
  const future = rateable.filter((m) => Date.parse(m.kickoff) > now);
  const defaultMatch =
    live.sort((a, b) => Date.parse(b.kickoff) - Date.parse(a.kickoff))[0] ??
    started.sort((a, b) => Date.parse(b.kickoff) - Date.parse(a.kickoff))[0] ??
    future.sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff))[0] ??
    null;

  // Upcoming fixtures we can rate (both teams known).
  const upcoming = matches
    .filter(
      (m) =>
        m.status !== 'FINISHED' &&
        m.home_code &&
        m.away_code &&
        lookup(m.home_code) &&
        lookup(m.away_code)
    )
    .slice(0, 14);

  // Live worked example for the explainer: a marquee matchup.
  const example = predict({ home: 'ARG', away: 'BRA', neutral: true })!;

  const lastUpdated = new Date(DATASET.generatedAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const topElo = Math.round(Math.max(...TEAMS.map((t) => t.elo)));
  const lowElo = Math.round(Math.min(...TEAMS.map((t) => t.elo)));

  return (
    <main>
      <h1>ML Predictor</h1>
      <p className="subtitle">
        A statistical model trained on {DATASET.matchesProcessed.toLocaleString()} international
        matches ({DATASET.dateRange[0].slice(0, 4)}–{DATASET.dateRange[1].slice(0, 4)}). Pick any
        two teams and see the real World Cup fixtures rated.
      </p>

      {/* ---- interactive picker ---- */}
      <section className="ml-section">
        <h2 className="ml-h2">Head-to-head predictor</h2>
        <p className="ml-lead">
          Choose two of the 48 qualified teams. Everything updates live in your browser.
        </p>
        <Suspense fallback={null}>
          <MatchupPicker
            confirmedByPair={confirmedByPair}
            lastLineupByTeam={lastLineupByTeam}
            defaultHome={defaultMatch?.home_code ?? undefined}
            defaultAway={defaultMatch?.away_code ?? undefined}
          />
        </Suspense>
      </section>

      {/* ---- how it works ---- */}
      <section className="ml-section">
        <h2 className="ml-h2">How it works</h2>

        <p className="ml-lead">
          The model never watches a game. It does three simple things: rate how strong each team is,
          work out how many goals each side is likely to score, then turn those goals into win
          chances. Here is each step.
        </p>

        <div className="ml-how">
          <div className="ml-how-step">
            <span className="ml-how-num">1</span>
            <div className="ml-how-body">
              <h3 className="ml-how-h">Rate how strong each team is</h3>
              <p>
                Every team gets a single number, its <strong>Elo rating</strong>, the same idea used
                to rank chess players and tennis pros. Everyone starts level at {MODEL.eloBaseline},
                the score of an average team. The model then replays all{' '}
                {DATASET.matchesProcessed.toLocaleString()} international matches ever recorded, from{' '}
                {DATASET.dateRange[0].slice(0, 4)} to today. After each game the winner takes points
                from the loser. Beating a strong team is worth more than beating a weak one, a big win
                counts for more than a narrow one, and a World Cup match moves the number far more than
                a friendly. Once every game has been played through, each team&apos;s number reflects
                how good it really is. The 48 teams here land between about {lowElo} and {topElo}.
              </p>
            </div>
          </div>

          <div className="ml-how-step">
            <span className="ml-how-num">2</span>
            <div className="ml-how-body">
              <h3 className="ml-how-h">Work out how many goals each side scores</h3>
              <p>
                From the same history, the model also learns two more numbers for every team: an{' '}
                <strong>attack</strong> rating (how many goals it tends to score) and a{' '}
                <strong>defence</strong> rating (how few it tends to concede). A match&apos;s expected
                goals come from pitting one side&apos;s attack against the other&apos;s defence: a great
                attack facing a leaky defence produces a high number, two strong defences produce a low
                one. Out comes an expected goal count for each team — something like 2.7 to 0.5 in a
                mismatch, or 1.3 to 0.9 in a close game. (On a true home ground, the host gets a small
                extra bump; at a neutral World Cup venue, neither side does.)
              </p>
            </div>
          </div>

          <div className="ml-how-step">
            <span className="ml-how-num">3</span>
            <div className="ml-how-body">
              <h3 className="ml-how-h">Turn the goals into win chances</h3>
              <p>
                A team expected to score 1.8 goals will not score exactly 1.8; real games end on 1, or
                2, or 0. So the model treats each team&apos;s goal count as a range of possibilities and
                works out the odds of every realistic score: 1–0, 2–1, 0–0, and so on. It also nudges
                the low-scoring draws (0–0, 1–1) up a touch, because tight games end level more often
                than pure chance suggests. Then it adds up all the scores where the first team wins, all
                the draws, and all the scores where the second team wins. Finally it blends those totals
                with two simpler reads — one from the teams&apos; overall strength gap (step 1), and one
                from the quality of each squad&apos;s player pool (its best players&apos; ratings). The
                three methods miss in different ways, so blending them is steadier and more accurate.
                The result is the <strong>win / draw / win</strong> percentages you see. Because goals
                involve luck, the model never says a result <em>will</em> happen, only how likely each one is.
              </p>
            </div>
          </div>
        </div>

        <div className="ml-pipeline">
          <h3 className="ml-h3">
            The same three steps, with real numbers: {example.home.name} vs {example.away.name}
          </h3>
          <ol className="ml-steps">
            <li>
              <span className="ml-step-k">Step 1 · Rate the teams</span>
              {example.home.name} is rated <strong>{example.home.elo.toFixed(0)}</strong> (the world&apos;s
              #{example.home.globalRank} side), {example.away.name}{' '}
              <strong>{example.away.elo.toFixed(0)}</strong> (#{example.away.globalRank}). That leaves a
              gap of <strong>{Math.abs(example.eloGap).toFixed(0)}</strong> points between them.
            </li>
            <li>
              <span className="ml-step-k">Step 2 · Estimate the goals</span>
              Pitting {example.home.name}&apos;s attack against {example.away.name}&apos;s defence (and
              vice versa) gives expected goals of{' '}
              <strong>{example.lambdaHome.toFixed(1)}</strong> for {example.home.name} and{' '}
              <strong>{example.lambdaAway.toFixed(1)}</strong> for {example.away.name} — a tight game,
              with {example.home.name} a shade ahead.
            </li>
            <li>
              <span className="ml-step-k">Step 3 · Work out the chances</span>
              Spreading those goals across every possible score and adding them up gives{' '}
              <strong>{pct(example.probHome)}</strong> {example.home.name},{' '}
              <strong>{pct(example.probDraw)}</strong> a draw, and{' '}
              <strong>{pct(example.probAway)}</strong> {example.away.name}. The single most likely
              score is{' '}
              <strong>
                {example.mostLikelyScore.home}–{example.mostLikelyScore.away}
              </strong>
              , though that alone only happens about {pct(example.mostLikelyScore.prob)} of the time.
            </li>
          </ol>
        </div>

        <div className="ml-pipeline ml-readme">
          <h3 className="ml-h3">Reading the two trickiest bits on screen</h3>
          <p>
            <strong>&ldquo;Strength (Elo) 1827 vs 1917&rdquo;</strong> is just the two ratings side by
            side. Don&apos;t worry about the raw figures; look at the gap. Here the second team is 90
            points stronger, a modest edge. As a rule of thumb: a 100-point gap is a real advantage,
            300 or more is a heavy favourite, and a gap near zero is a coin flip.
          </p>
          <p>
            <strong>The scorelines list</strong> shows the most probable final scores.{' '}
            &ldquo;1–1, 11.1%&rdquo; means about an 11% chance the game ends one goal each, with the
            first team&apos;s goals listed first. Since a match can finish on so many scores, even the
            likeliest one is usually only around 10%, so treat it as a single guess among many. The
            win / draw / win percentages up top are the reliable part.
          </p>
        </div>
      </section>

      {/* ---- real fixtures ---- */}
      {upcoming.length > 0 && (
        <section className="ml-section">
          <h2 className="ml-h2">Upcoming fixtures, rated<ChartTag kind="prediction" /></h2>
          <p className="ml-lead">
            Model predictions for the next World Cup 2026 matches — win/draw/win odds and the single
            likeliest score. Where Polymarket is trading the match, a live &ldquo;Market&rdquo; line
            shows what bettors are pricing it at, refreshed every 20 seconds.
          </p>
          <MarketOddsProvider>
            <div className="ml-fixtures">
              {upcoming.map((m) => {
                const r = predict({ home: m.home_code!, away: m.away_code!, neutral: true })!;
                return (
                  <div className="ml-fixture" key={m.id}>
                    <div className="ml-fix-top">
                      <span className="ml-fix-team">
                        <Flag code={m.home_code} name={m.home_team} />
                        {m.home_team}
                      </span>
                      <span className="ml-fix-meta">
                        {stageLabel(m.stage, m.group_name)} ·{' '}
                        {new Date(m.kickoff).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                      <span className="ml-fix-team ml-fix-right">
                        {m.away_team}
                        <Flag code={m.away_code} name={m.away_team} />
                      </span>
                    </div>
                    <div className="ml-fix-probs">
                      <span>{pct(r.probHome)}</span>
                      <span className="ml-fix-draw">{pct(r.probDraw)}</span>
                      <span>{pct(r.probAway)}</span>
                    </div>
                    <MiniBar h={r.probHome} d={r.probDraw} a={r.probAway} />
                    <div className="ml-fix-score">
                      likely {r.mostLikelyScore.home}–{r.mostLikelyScore.away}
                    </div>
                    <MarketOddsRow home={m.home_code!} away={m.away_code!} />
                  </div>
                );
              })}
            </div>
          </MarketOddsProvider>
        </section>
      )}

      <p className="ml-foot">
        Model and ratings rebuilt {lastUpdated} from {DATASET.source}. Dixon-Coles attack/defence with
        a low-score correction, blended with an Elo strength model and a FIFA squad talent-pool model
        for steadier win/draw/win odds, computed in your browser and on the server. The optional
        &ldquo;Market&rdquo; line on each fixture is live, real-money pricing from Polymarket — shown
        alongside the model, not used to compute it.
      </p>
    </main>
  );
}
