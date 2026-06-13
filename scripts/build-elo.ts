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
