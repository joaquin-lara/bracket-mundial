import type { Metadata } from 'next';
import './predictor.css';
import Flag from '@/components/Flag';
import MatchupPicker from '@/components/MatchupPicker';
import { ensureFreshScores } from '@/lib/autoSync';
import { createClient } from '@/lib/supabase/server';
import type { Match } from '@/lib/types';
import { stageLabel } from '@/lib/types';
import { predict, pct } from '@/lib/ml/model';
import { DATASET, MODEL, lookup, TEAMS } from '@/lib/ml/teams';
import {
  simulate,
  type SimGroup,
  type SimFixture,
  type SimResult,
} from '@/lib/ml/simulate';

export const metadata: Metadata = { title: 'ML Predictor' };
export const dynamic = 'force-dynamic';

function isGroupStage(m: Match): boolean {
  return (
    m.group_name != null ||
    m.stage === 'GROUP_STAGE' ||
    m.stage === 'GROUP'
  );
}

/** Derive the 12 groups and their fixtures (by TLA code) from the live table. */
function buildGroups(matches: Match[]): { groups: SimGroup[]; fixtures: SimFixture[] } {
  const groupTeams = new Map<string, Set<string>>();
  const fixtures: SimFixture[] = [];
  for (const m of matches) {
    if (!isGroupStage(m) || !m.group_name) continue;
    if (!m.home_code || !m.away_code) continue;
    if (!lookup(m.home_code) || !lookup(m.away_code)) continue;
    if (!groupTeams.has(m.group_name)) groupTeams.set(m.group_name, new Set());
    groupTeams.get(m.group_name)!.add(m.home_code);
    groupTeams.get(m.group_name)!.add(m.away_code);
    fixtures.push({
      group: m.group_name,
      home: m.home_code,
      away: m.away_code,
      played: m.status === 'FINISHED' && m.home_score != null && m.away_score != null,
      homeScore: m.home_score,
      awayScore: m.away_score,
    });
  }
  const groups: SimGroup[] = [...groupTeams.entries()]
    .filter(([, s]) => s.size === 4)
    .map(([name, s]) => ({ name, teams: [...s] }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { groups, fixtures };
}

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

  const { groups, fixtures } = buildGroups(matches);
  let sim: SimResult | null = null;
  if (groups.length === 12) {
    // 12 complete groups -> exactly 32 advancers -> a clean knockout bracket.
    sim = simulate(groups, fixtures, 4000);
  }

  // Live worked example for the explainer: a marquee matchup.
  const example = predict({ home: 'ARG', away: 'BRA', neutral: true })!;
  const exHalf = (MODEL.avgTotalGoals / 2).toFixed(2);
  const exSupremacy = (example.eloGap * MODEL.goalsPerElo).toFixed(2);

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
        two teams, see the real fixtures rated, and simulate the whole tournament.
      </p>

      {/* ---- interactive picker ---- */}
      <section className="ml-section">
        <h2 className="ml-h2">Head-to-head predictor</h2>
        <p className="ml-lead">
          Choose two of the 48 qualified teams. Everything updates live in your browser.
        </p>
        <MatchupPicker />
      </section>

      {/* ---- how it works ---- */}
      <section className="ml-section">
        <h2 className="ml-h2">How it works</h2>

        <p className="ml-lead">
          The model never watches a game. It does three simple things: rate how strong each team is,
          use the gap between two teams to estimate goals, then turn those goals into win chances.
          Here is each step.
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
              <h3 className="ml-how-h">Use the gap to estimate goals</h3>
              <p>
                For a single match, only the <em>gap</em> between the two ratings matters, not the raw
                numbers. The model starts from one fact taken straight from history: an average
                international has about {MODEL.avgTotalGoals.toFixed(1)} goals in it. It splits those
                goals between the two teams, then slides them toward the stronger side in proportion to
                the gap, where every 100 Elo points is worth roughly half a goal. Out comes an expected
                goal count for each team: something like 2.8 to 0.9 in a mismatch, or 1.5 to 1.3 in a
                close game.
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
                works out the odds of every realistic score: 1–0, 2–1, 0–0, and so on. Then it adds up
                all the scores where the first team wins, all the draws, and all the scores where the
                second team wins. Those three totals are the <strong>win / draw / win</strong>{' '}
                percentages you see. Because goals involve luck, the model never says a result{' '}
                <em>will</em> happen, only how likely each one is.
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
              Start with the average {MODEL.avgTotalGoals.toFixed(1)} goals, split evenly ({exHalf}{' '}
              each), then slide {exSupremacy} of a goal toward the stronger side. Expected goals come
              out at <strong>{example.lambdaHome.toFixed(1)}</strong> for {example.home.name} and{' '}
              <strong>{example.lambdaAway.toFixed(1)}</strong> for {example.away.name}.
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
          <h2 className="ml-h2">Upcoming fixtures, rated</h2>
          <p className="ml-lead">The model&apos;s read on the next World Cup 2026 matches.</p>
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
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ---- tournament simulation ---- */}
      {sim && (
        <section className="ml-section">
          <h2 className="ml-h2">Tournament simulation</h2>
          <p className="ml-lead">
            The full World Cup played out {sim.iterations.toLocaleString()} times. Finished group
            games are locked in; everything else is sampled from the model. Knockout pairings are
            seeded by strength (an approximation of the official bracket), so treat title odds as a
            strength-driven estimate.
          </p>
          <div className="ml-odds">
            <div className="ml-odds-head">
              <span>Team</span>
              <span>Advance</span>
              <span>Final</span>
              <span>Title</span>
            </div>
            {sim.teams.slice(0, 16).map((t) => (
              <div className="ml-odds-row" key={t.code}>
                <span className="ml-odds-team">
                  <Flag code={t.code} name={t.name} />
                  {t.name}
                </span>
                <span className="ml-odds-v">{(t.advance * 100).toFixed(0)}%</span>
                <span className="ml-odds-v">{(t.final * 100).toFixed(1)}%</span>
                <span className="ml-odds-v ml-odds-title">{(t.title * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="ml-foot">
        Model and ratings rebuilt {lastUpdated} from {DATASET.source}. Elo + Poisson, computed in
        your browser and on the server. No external prediction service.
      </p>
    </main>
  );
}
