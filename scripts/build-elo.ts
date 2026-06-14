/**
 * Builds the ML Predictor's rating table from the historical international
 * results dataset (martj42/international_results, the public mirror of the
 * Kaggle "International football results 1872-present" set).
 *
 * It runs a World Football Elo pass (eloratings.net methodology) over every
 * completed international, then writes src/lib/ml/ratings.json: the final Elo,
 * recent form and global rank for each of the 48 WC 2026 teams, plus two
 * constants fitted from the data (goals-per-Elo and average goals) that the
 * in-app Poisson model uses to turn ratings into scorelines.
 *
 * The heavy work happens here, offline. Production only imports the JSON, so
 * there is no Python service and nothing to fetch at runtime.
 *
 *   Download data (if missing) and rebuild:  npm run build:elo
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import https from 'https';

const ROOT = process.cwd();
const CSV_PATH = path.join(ROOT, 'data', 'results.csv');
const OUT_PATH = path.join(ROOT, 'src', 'lib', 'ml', 'ratings.json');
const CSV_URL =
  'https://raw.githubusercontent.com/martj42/international_results/master/results.csv';

// --- the 48 WC 2026 teams: dataset spelling -> football-data TLA code -------
// The TLA is the join key with the live fixtures table (matches.home_code).
const WC2026: Record<string, string> = {
  Algeria: 'ALG', Argentina: 'ARG', Australia: 'AUS', Austria: 'AUT',
  Belgium: 'BEL', 'Bosnia and Herzegovina': 'BIH', Brazil: 'BRA', Canada: 'CAN',
  'Cape Verde': 'CPV', Colombia: 'COL', Croatia: 'CRO', 'Curaçao': 'CUR',
  'Czech Republic': 'CZE', 'DR Congo': 'COD', Ecuador: 'ECU', Egypt: 'EGY',
  England: 'ENG', France: 'FRA', Germany: 'GER', Ghana: 'GHA', Haiti: 'HAI',
  Iran: 'IRN', Iraq: 'IRQ', 'Ivory Coast': 'CIV', Japan: 'JPN', Jordan: 'JOR',
  Mexico: 'MEX', Morocco: 'MAR', Netherlands: 'NED', 'New Zealand': 'NZL',
  Norway: 'NOR', Panama: 'PAN', Paraguay: 'PAR', Portugal: 'POR', Qatar: 'QAT',
  'Saudi Arabia': 'KSA', Scotland: 'SCO', Senegal: 'SEN', 'South Africa': 'RSA',
  'South Korea': 'KOR', Spain: 'ESP', Sweden: 'SWE', Switzerland: 'SUI',
  Tunisia: 'TUN', Turkey: 'TUR', 'United States': 'USA', Uruguay: 'URY',
  Uzbekistan: 'UZB',
};

const HOME_ADV = 100; // Elo points added to the home side on non-neutral grounds

// Tournament importance -> Elo K-factor (eloratings.net weight classes).
function kFactor(tournament: string): number {
  const t = tournament.toLowerCase();
  if (t === 'fifa world cup') return 60;
  if (t.includes('world cup')) return 40; // qualification + play-offs
  if (t.includes('confederations')) return 50;
  if (
    t.includes('uefa euro') || t.includes('copa américa') || t.includes('copa america') ||
    t.includes('african cup of nations') || t.includes('afc asian cup') ||
    t.includes('gold cup') || t.includes('nations league')
  ) {
    return t.includes('qualification') ? 40 : 50;
  }
  if (t === 'friendly') return 20;
  return 30; // other competitive tournaments
}

// Goal-difference multiplier (G): rewards bigger wins, with diminishing returns.
function marginMultiplier(goalDiff: number): number {
  const m = Math.abs(goalDiff);
  if (m <= 1) return 1;
  if (m === 2) return 1.5;
  return (11 + m) / 8;
}

interface Row {
  date: string;
  home: string;
  away: string;
  hs: number;
  as: number;
  tournament: string;
  neutral: boolean;
}

function download(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    mkdirSync(path.dirname(dest), { recursive: true });
    const file = require('fs').createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.headers.location) {
          // follow one redirect
          https.get(res.headers.location, (r2) => r2.pipe(file)).on('error', reject);
          file.on('finish', () => file.close(() => resolve()));
          return;
        }
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
      })
      .on('error', reject);
  });
}

function parseCsv(text: string): Row[] {
  const lines = text.split(/\r?\n/);
  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const c = line.split(',');
    if (c.length < 9) continue;
    const hs = Number(c[3]);
    const as = Number(c[4]);
    if (!Number.isFinite(hs) || !Number.isFinite(as)) continue; // skip future/NA fixtures
    rows.push({
      date: c[0],
      home: c[1],
      away: c[2],
      hs,
      as,
      tournament: c[5],
      // neutral is the last column regardless of any stray commas earlier
      neutral: c[c.length - 1].trim().toUpperCase() === 'TRUE',
    });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

interface TeamState {
  elo: number;
  matches: number;
  lastPlayed: string;
  history: { date: string; gf: number; ga: number; opp: string }[];
}

function main() {
  if (!existsSync(CSV_PATH)) {
    console.error('results.csv not found; download it first.');
    process.exit(1);
  }
  const rows = parseCsv(readFileSync(CSV_PATH, 'utf8'));
  console.log(`Parsed ${rows.length} completed internationals.`);

  const teams = new Map<string, TeamState>();
  const get = (name: string): TeamState => {
    let t = teams.get(name);
    if (!t) {
      t = { elo: 1500, matches: 0, lastPlayed: '', history: [] };
      teams.set(name, t);
    }
    return t;
  };

  // Accumulators for the data-fitted Poisson constants.
  let sumDiffXElo = 0; // sum(eloDiffAdj * goalDiff)
  let sumEloSq = 0; // sum(eloDiffAdj^2)
  let sumTotalGoals = 0;
  let sumHomeMargin = 0;
  let nonNeutral = 0;

  // --- Dixon-Coles online model (the live predictor's goal model) ------------
  // Each team carries a log-scale attack and defense rating; goal means are
  //   lambdaHome = exp(base + homeAdv + att_home - def_away)
  //   lambdaAway = exp(base +          att_away - def_home)
  // After each match the ratings take a gradient step on the Poisson
  // log-likelihood (observed - expected goals), so this is "Elo for goals". It
  // beat the Elo+independent-Poisson model out of sample in scripts/backtest.ts
  // (RPS 0.1654 vs 0.1672), so it is what ships. Hyperparameters match that
  // harness exactly; the only difference is we run over the full history here.
  const dcAtt = new Map<string, number>();
  const dcDef = new Map<string, number>();
  let dcBase = Math.log(1.35); // ~log(avg goals per team); drifts online
  let dcHome = 0.25; // home advantage in log-goal space
  const DC_LR_TEAM = 0.05;
  const DC_LR_GLOBAL = 0.004;
  const DC_RHO = -0.07; // low-score correction (negative inflates draws)
  const DC_SHRINK = 0.0015; // pull ratings toward 0: regularize + time-decay
  const DC_FRIENDLY_W = 0.5;
  const aOf = (t: string) => dcAtt.get(t) ?? 0;
  const dOf = (t: string) => dcDef.get(t) ?? 0;

  for (const r of rows) {
    const h = get(r.home);
    const a = get(r.away);
    const eloDiffAdj = h.elo - a.elo + (r.neutral ? 0 : HOME_ADV);

    // Expected result for the home side (logistic on the Elo gap).
    const expH = 1 / (1 + Math.pow(10, -eloDiffAdj / 400));
    const resultH = r.hs > r.as ? 1 : r.hs < r.as ? 0 : 0.5;

    const k = kFactor(r.tournament);
    const g = marginMultiplier(r.hs - r.as);
    const delta = k * g * (resultH - expH);
    h.elo += delta;
    a.elo -= delta;

    // Fit accumulators (use the pre-update Elo gap, the real predictive input).
    const goalDiff = r.hs - r.as;
    sumDiffXElo += eloDiffAdj * goalDiff;
    sumEloSq += eloDiffAdj * eloDiffAdj;
    sumTotalGoals += r.hs + r.as;
    if (!r.neutral) {
      sumHomeMargin += goalDiff;
      nonNeutral++;
    }

    // Dixon-Coles online step (predict-then-update, same as the backtest).
    const lh = Math.exp(dcBase + (r.neutral ? 0 : dcHome) + aOf(r.home) - dOf(r.away));
    const la = Math.exp(dcBase + aOf(r.away) - dOf(r.home));
    const w = r.tournament.toLowerCase() === 'friendly' ? DC_FRIENDLY_W : 1;
    const eh = r.hs - lh; // gradient of att_home / -def_away
    const ea = r.as - la; // gradient of att_away / -def_home
    const lr = DC_LR_TEAM * w;
    dcAtt.set(r.home, aOf(r.home) * (1 - DC_SHRINK) + lr * eh);
    dcDef.set(r.away, dOf(r.away) * (1 - DC_SHRINK) - lr * eh);
    dcAtt.set(r.away, aOf(r.away) * (1 - DC_SHRINK) + lr * ea);
    dcDef.set(r.home, dOf(r.home) * (1 - DC_SHRINK) - lr * ea);
    dcBase += DC_LR_GLOBAL * w * (eh + ea);
    if (!r.neutral) dcHome += DC_LR_GLOBAL * w * eh;

    for (const [side, gf, ga, opp] of [
      [h, r.hs, r.as, r.away],
      [a, r.as, r.hs, r.home],
    ] as [TeamState, number, number, string][]) {
      side.matches++;
      side.lastPlayed = r.date;
      side.history.push({ date: r.date, gf, ga, opp });
    }
  }

  const goalsPerElo = sumDiffXElo / sumEloSq; // goals of supremacy per Elo point
  const avgTotalGoals = sumTotalGoals / rows.length;
  const homeMarginGoals = sumHomeMargin / nonNeutral;

  // Global ranking across every team that has played >= 30 matches.
  const ranked = [...teams.entries()]
    .filter(([, t]) => t.matches >= 30)
    .sort((a, b) => b[1].elo - a[1].elo);
  const rankOf = new Map(ranked.map(([name], i) => [name, i + 1]));
  const totalRanked = ranked.length;

  const out: any = {
    generatedAt: new Date().toISOString(),
    source: 'martj42/international_results (mirror of Kaggle international results 1872-present)',
    matchesProcessed: rows.length,
    dateRange: [rows[0].date, rows[rows.length - 1].date],
    model: {
      homeAdvantageElo: HOME_ADV,
      goalsPerElo: round(goalsPerElo, 6),
      avgTotalGoals: round(avgTotalGoals, 4),
      homeMarginGoals: round(homeMarginGoals, 4),
      eloBaseline: 1500,
      // Dixon-Coles global params the live predictor needs to turn the per-team
      // attack/defense ratings into goal means and corrected scorelines.
      dc: {
        base: round(dcBase, 6),
        home: round(dcHome, 6),
        rho: DC_RHO,
      },
    },
    totalRankedTeams: totalRanked,
    teams: {} as Record<string, unknown>,
  };

  for (const [name, code] of Object.entries(WC2026)) {
    const t = teams.get(name);
    if (!t) {
      console.warn(`WARN: ${name} not found in dataset`);
      continue;
    }
    const last10 = t.history.slice(-10);
    let w = 0, d = 0, l = 0, gf = 0, ga = 0;
    for (const m of last10) {
      gf += m.gf; ga += m.ga;
      if (m.gf > m.ga) w++; else if (m.gf < m.ga) l++; else d++;
    }
    out.teams[code] = {
      name,
      code,
      elo: round(t.elo, 1),
      matches: t.matches,
      lastPlayed: t.lastPlayed,
      globalRank: rankOf.get(name) ?? null,
      // Dixon-Coles attack (goals scored) and defense (goals prevented) ratings
      // in log-goal space, learned over the full history. The live goal model.
      dcAtt: round(dcAtt.get(name) ?? 0, 4),
      dcDef: round(dcDef.get(name) ?? 0, 4),
      form: {
        played: last10.length,
        won: w, drawn: d, lost: l,
        goalsFor: gf, goalsAgainst: ga,
        recent: last10.map((m) => ({
          date: m.date, opp: m.opp, gf: m.gf, ga: m.ga,
        })),
      },
    };
  }

  mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`Wrote ${OUT_PATH}`);
  console.log(
    `Constants: goalsPerElo=${out.model.goalsPerElo}, avgTotalGoals=${out.model.avgTotalGoals}, homeMarginGoals=${out.model.homeMarginGoals}`
  );
  // Quick sanity print: top 5 of the 48 by Elo.
  const top = Object.values(out.teams as Record<string, any>)
    .sort((a, b) => b.elo - a.elo)
    .slice(0, 5)
    .map((t) => `${t.name} ${t.elo} (#${t.globalRank})`);
  console.log('Top WC teams:', top.join(', '));
}

function round(n: number, dp: number): number {
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

async function ensureData() {
  if (!existsSync(CSV_PATH)) {
    console.log('Downloading results.csv ...');
    await download(CSV_URL, CSV_PATH);
  }
}

ensureData().then(main);
