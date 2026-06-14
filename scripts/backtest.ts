/**
 * Walk-forward backtest harness for the match predictor.
 *
 * Replays every international in chronological order. For matches in the
 * evaluation window it asks each model for win/draw/loss probabilities BEFORE
 * the result is revealed, scores that prediction, and only then lets the model
 * update its state. Predicting strictly before updating makes this a genuine
 * one-step-ahead (prequential) test: no model ever sees the match it is rating,
 * so there is no lookahead leakage.
 *
 * Scoring uses proper scoring rules:
 *   - RPS (Ranked Probability Score) -- the standard for ordered H/D/A football
 *     forecasts (Constantinou & Fenton). Lower is better.
 *   - Multiclass log-loss and Brier score. Lower is better.
 *   - Accuracy (argmax) for intuition only -- it is NOT a proper score.
 * Plus a reliability/calibration table for the home-win probability.
 *
 *   npm run backtest            # evaluate from 2015-01-01
 *   npm run backtest 2018-01-01 # custom evaluation start
 */
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { scoreGrid } from '../src/lib/ml/poisson';
import { strengthAsOf, squadDataAvailable } from './squad-strength';

const ROOT = process.cwd();
const CSV_PATH = path.join(ROOT, 'data', 'results.csv');
const EVAL_START = process.argv[2] ?? '2015-01-01';
// Validation window [VALID_START, EVAL_START): used to fit recalibration only,
// never scored. Model constants are fitted before VALID_START; calibration on
// the validation window; final metrics on the eval window. A clean 3-way split.
const VALID_START = process.argv[3] ?? '2013-01-01';
const HOME_ADV = 100; // matches build-elo
const MAX_GOALS = 8;
const MIN_HISTORY = 5; // a model abstains until both teams have this many games

// --- dataset parsing (mirrors scripts/build-elo.ts) -------------------------
interface Row {
  date: string;
  home: string;
  away: string;
  hs: number;
  as: number;
  tournament: string;
  neutral: boolean;
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
    if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
    rows.push({
      date: c[0],
      home: c[1],
      away: c[2],
      hs,
      as,
      tournament: c[5],
      neutral: c[c.length - 1].trim().toUpperCase() === 'TRUE',
    });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

function kFactor(tournament: string): number {
  const t = tournament.toLowerCase();
  if (t === 'fifa world cup') return 60;
  if (t.includes('world cup')) return 40;
  if (t.includes('confederations')) return 50;
  if (
    t.includes('uefa euro') || t.includes('copa américa') || t.includes('copa america') ||
    t.includes('african cup of nations') || t.includes('afc asian cup') ||
    t.includes('gold cup') || t.includes('nations league')
  ) {
    return t.includes('qualification') ? 40 : 50;
  }
  if (t === 'friendly') return 20;
  return 30;
}

function marginMultiplier(goalDiff: number): number {
  const m = Math.abs(goalDiff);
  if (m <= 1) return 1;
  if (m === 2) return 1.5;
  return (11 + m) / 8;
}

type Outcome = 'H' | 'D' | 'A';
function outcomeOf(hs: number, as: number): Outcome {
  return hs > as ? 'H' : hs < as ? 'A' : 'D';
}

interface Probs {
  H: number;
  D: number;
  A: number;
}

/** A model the harness can walk forward: predict before update, update always. */
interface Predictor {
  readonly name: string;
  /** Probabilities for this match, or null to abstain (too little history). */
  predict(row: Row): Probs | null;
  /** Ingest the result. `inTrain` is true for pre-evaluation matches only. */
  update(row: Row, inTrain: boolean): void;
  /** Called once when the evaluation window begins; freeze any fitted params. */
  freeze(): void;
}

// --- model 1: the current Elo + independent-Poisson predictor ---------------
class EloPoissonModel implements Predictor {
  readonly name = 'Elo + independent Poisson (current model)';
  private elo = new Map<string, number>();
  private played = new Map<string, number>();
  // constants fitted on the training prefix only (no leakage from eval window)
  private sDiffXElo = 0;
  private sEloSq = 0;
  private sTotal = 0;
  private nFit = 0;
  private goalsPerElo = 0;
  private avgTotalGoals = 0;

  private getElo(t: string): number {
    return this.elo.get(t) ?? 1500;
  }

  freeze(): void {
    this.goalsPerElo = this.sDiffXElo / this.sEloSq;
    this.avgTotalGoals = this.sTotal / this.nFit;
  }

  predict(r: Row): Probs | null {
    if ((this.played.get(r.home) ?? 0) < MIN_HISTORY) return null;
    if ((this.played.get(r.away) ?? 0) < MIN_HISTORY) return null;
    const gap = this.getElo(r.home) - this.getElo(r.away) + (r.neutral ? 0 : HOME_ADV);
    const sup = gap * this.goalsPerElo;
    const half = this.avgTotalGoals / 2;
    const lh = Math.max(0.15, half + sup / 2);
    const la = Math.max(0.15, half - sup / 2);
    const g = scoreGrid(lh, la, MAX_GOALS);
    return { H: g.pHome, D: g.pDraw, A: g.pAway };
  }

  update(r: Row, inTrain: boolean): void {
    const gap = this.getElo(r.home) - this.getElo(r.away) + (r.neutral ? 0 : HOME_ADV);
    const expH = 1 / (1 + Math.pow(10, -gap / 400));
    const resH = r.hs > r.as ? 1 : r.hs < r.as ? 0 : 0.5;
    const delta = kFactor(r.tournament) * marginMultiplier(r.hs - r.as) * (resH - expH);
    this.elo.set(r.home, this.getElo(r.home) + delta);
    this.elo.set(r.away, this.getElo(r.away) - delta);
    this.played.set(r.home, (this.played.get(r.home) ?? 0) + 1);
    this.played.set(r.away, (this.played.get(r.away) ?? 0) + 1);
    if (inTrain) {
      this.sDiffXElo += gap * (r.hs - r.as);
      this.sEloSq += gap * gap;
      this.sTotal += r.hs + r.as;
      this.nFit++;
    }
  }
}

// --- model 2: base-rate baseline (constant H/D/A from the training prefix) --
class BaseRateModel implements Predictor {
  readonly name = 'Base rate (constant H/D/A)';
  private h = 0;
  private d = 0;
  private a = 0;
  private n = 0;
  private rate: Probs = { H: 0.45, D: 0.25, A: 0.3 };

  freeze(): void {
    this.rate = { H: this.h / this.n, D: this.d / this.n, A: this.a / this.n };
  }
  predict(): Probs | null {
    return this.rate;
  }
  update(r: Row, inTrain: boolean): void {
    if (!inTrain) return;
    const o = outcomeOf(r.hs, r.as);
    if (o === 'H') this.h++;
    else if (o === 'D') this.d++;
    else this.a++;
    this.n++;
  }
}

// --- model 3: online Dixon-Coles (attack/defense + low-score correction) ----
// Each team carries a log-scale attack and defense rating. Goal means are
//   lambda_home = exp(base + home[neutral?0] + att_home - def_away)
//   lambda_away = exp(base +                  att_away - def_home)
// After each match the ratings take a gradient step on the Poisson
// log-likelihood (for a log link the gradient is simply observed - expected
// goals), so this is "Elo for goals" and updates online -- no batch refit, and
// leakage-free in the walk-forward loop. The Dixon-Coles tau correction tilts
// the four low-score cells (0-0, 1-0, 0-1, 1-1) to fix the draw deficit of an
// independent Poisson. Friendlies move the ratings less than competitive games.
class DixonColesOnline implements Predictor {
  readonly name = 'Dixon-Coles online (attack/defense)';
  private att = new Map<string, number>();
  private def = new Map<string, number>();
  private played = new Map<string, number>();
  private base = Math.log(1.35); // ~ log(avg goals per team); drifts online
  private home = 0.25; // home advantage in log-goal space

  // hyperparameters (literature-sensible defaults; not tuned on the eval window)
  private readonly lrTeam = 0.05;
  private readonly lrGlobal = 0.004;
  private readonly rho = -0.07; // low-score correction (negative inflates draws)
  private readonly shrink = 0.0015; // pull ratings toward 0: regularize + time-decay
  private readonly friendlyWeight = 0.5;

  private a(t: string): number {
    return this.att.get(t) ?? 0;
  }
  private d(t: string): number {
    return this.def.get(t) ?? 0;
  }

  freeze(): void {
    /* nothing to freeze: the model learns online through the training prefix */
  }

  private means(r: Row): [number, number] {
    const lh = Math.exp(this.base + (r.neutral ? 0 : this.home) + this.a(r.home) - this.d(r.away));
    const la = Math.exp(this.base + this.a(r.away) - this.d(r.home));
    return [lh, la];
  }

  predict(r: Row): Probs | null {
    if ((this.played.get(r.home) ?? 0) < MIN_HISTORY) return null;
    if ((this.played.get(r.away) ?? 0) < MIN_HISTORY) return null;
    const [lh, la] = this.means(r);
    const g = scoreGrid(lh, la, MAX_GOALS);
    let pH = 0,
      pD = 0,
      pA = 0,
      tot = 0;
    for (const c of g.cells) {
      let f = 1;
      if (c.home === 0 && c.away === 0) f = 1 - lh * la * this.rho;
      else if (c.home === 0 && c.away === 1) f = 1 + lh * this.rho;
      else if (c.home === 1 && c.away === 0) f = 1 + la * this.rho;
      else if (c.home === 1 && c.away === 1) f = 1 - this.rho;
      const p = Math.max(0, c.prob * f);
      tot += p;
      if (c.home > c.away) pH += p;
      else if (c.home === c.away) pD += p;
      else pA += p;
    }
    return { H: pH / tot, D: pD / tot, A: pA / tot };
  }

  update(r: Row): void {
    const [lh, la] = this.means(r);
    const w = r.tournament.toLowerCase() === 'friendly' ? this.friendlyWeight : 1;
    const eh = r.hs - lh; // gradient of att_home / -def_away
    const ea = r.as - la; // gradient of att_away / -def_home
    const lr = this.lrTeam * w;
    this.att.set(r.home, this.a(r.home) * (1 - this.shrink) + lr * eh);
    this.def.set(r.away, this.d(r.away) * (1 - this.shrink) - lr * eh);
    this.att.set(r.away, this.a(r.away) * (1 - this.shrink) + lr * ea);
    this.def.set(r.home, this.d(r.home) * (1 - this.shrink) - lr * ea);
    this.base += this.lrGlobal * w * (eh + ea);
    if (!r.neutral) this.home += this.lrGlobal * w * eh;
    this.played.set(r.home, (this.played.get(r.home) ?? 0) + 1);
    this.played.set(r.away, (this.played.get(r.away) ?? 0) + 1);
  }
}

// --- model 4: squad strength only (FIFA talent pool) ------------------------
// Same goals->probabilities machinery as the Elo model, but the strength gap
// comes from the FIFA talent-pool ratings instead of results. Its own
// goals-per-strength-point constant is fitted on the training prefix. Abstains
// when either side has no rated pool for that date.
class SquadModel implements Predictor {
  readonly name = 'Squad strength only (FIFA talent pool)';
  private sDiffXStr = 0;
  private sStrSq = 0;
  private sTotal = 0;
  private nFit = 0;
  private goalsPerStr = 0;
  private avgTotalGoals = 0;

  freeze(): void {
    this.goalsPerStr = this.sDiffXStr / this.sStrSq;
    this.avgTotalGoals = this.sTotal / this.nFit;
  }

  private gap(r: Row): number | null {
    const h = strengthAsOf(r.home, r.date);
    const a = strengthAsOf(r.away, r.date);
    if (h == null || a == null) return null;
    return h - a;
  }

  predict(r: Row): Probs | null {
    const g = this.gap(r);
    if (g == null) return null;
    const sup = g * this.goalsPerStr;
    const half = this.avgTotalGoals / 2;
    const lh = Math.max(0.15, half + sup / 2);
    const la = Math.max(0.15, half - sup / 2);
    const grid = scoreGrid(lh, la, MAX_GOALS);
    return { H: grid.pHome, D: grid.pDraw, A: grid.pAway };
  }

  update(r: Row, inTrain: boolean): void {
    if (!inTrain) return;
    const g = this.gap(r);
    if (g == null) return;
    this.sDiffXStr += g * (r.hs - r.as);
    this.sStrSq += g * g;
    this.sTotal += r.hs + r.as;
    this.nFit++;
  }
}

// --- model 5: ensemble of two predictors (simple probability average) -------
class EnsembleModel implements Predictor {
  readonly name: string;
  constructor(private a: Predictor, private b: Predictor, private wa = 0.5) {
    this.name = `Ensemble (${Math.round(wa * 100)}% DC + ${Math.round((1 - wa) * 100)}% squad)`;
  }
  freeze(): void {}
  predict(r: Row): Probs | null {
    const pa = this.a.predict(r);
    const pb = this.b.predict(r);
    if (!pa || !pb) return null;
    const wb = 1 - this.wa;
    return {
      H: this.wa * pa.H + wb * pb.H,
      D: this.wa * pa.D + wb * pb.D,
      A: this.wa * pa.A + wb * pb.A,
    };
  }
  update(): void {}
}

// --- probability recalibration (temperature scaling) ------------------------
// Rescale a probability vector by a single temperature T. T<1 sharpens (more
// confident), T>1 softens. Monotonic, so it never reorders the outcomes.
function applyTemp(p: Probs, T: number): Probs {
  const a = Math.pow(Math.max(p.H, 1e-15), 1 / T);
  const b = Math.pow(Math.max(p.D, 1e-15), 1 / T);
  const c = Math.pow(Math.max(p.A, 1e-15), 1 / T);
  const s = a + b + c;
  return { H: a / s, D: b / s, A: c / s };
}

function valLogloss(pairs: { p: Probs; o: Outcome }[], T: number): number {
  let s = 0;
  for (const { p, o } of pairs) {
    const q = applyTemp(p, T);
    const pa = o === 'H' ? q.H : o === 'D' ? q.D : q.A;
    s += -Math.log(Math.max(pa, 1e-15));
  }
  return s / pairs.length;
}

/** Temperature that minimises validation log-loss (coarse grid, then refine). */
function fitTemperature(pairs: { p: Probs; o: Outcome }[]): number {
  if (pairs.length < 50) return 1;
  let best = 1;
  let bestLL = Infinity;
  for (let T = 0.5; T <= 2.0001; T += 0.05) {
    const l = valLogloss(pairs, T);
    if (l < bestLL) {
      bestLL = l;
      best = T;
    }
  }
  for (let T = best - 0.05; T <= best + 0.05; T += 0.005) {
    if (T <= 0.05) continue;
    const l = valLogloss(pairs, T);
    if (l < bestLL) {
      bestLL = l;
      best = T;
    }
  }
  return best;
}

// Wraps a base model and rescales its output by a temperature fitted on the
// validation window only, so the test window stays untouched.
class CalibratedModel implements Predictor {
  readonly name: string;
  T = 1;
  private pairs: { p: Probs; o: Outcome }[] = [];
  constructor(private base: Predictor) {
    this.name = `${base.name} + recalibration`;
  }
  collect(r: Row, o: Outcome): void {
    const p = this.base.predict(r);
    if (p) this.pairs.push({ p, o });
  }
  freeze(): void {
    this.T = fitTemperature(this.pairs);
  }
  predict(r: Row): Probs | null {
    const p = this.base.predict(r);
    return p ? applyTemp(p, this.T) : null;
  }
  update(): void {} // the wrapped base model updates itself via the models list
}

// --- metrics ----------------------------------------------------------------
const BINS = 10;
class Metrics {
  n = 0;
  logloss = 0;
  rps = 0;
  brier = 0;
  correct = 0;
  // calibration on the home-win probability
  binPred = new Array(BINS).fill(0);
  binObs = new Array(BINS).fill(0);
  binN = new Array(BINS).fill(0);

  add(p: Probs, o: Outcome): void {
    this.n++;
    const pa = o === 'H' ? p.H : o === 'D' ? p.D : p.A;
    this.logloss += -Math.log(Math.max(pa, 1e-15));
    // RPS over the ordered outcomes [H, D, A]
    const cum1 = p.H;
    const cum2 = p.H + p.D;
    const e1 = o === 'H' ? 1 : 0;
    const e2 = o === 'A' ? 0 : 1; // 1 for H or D
    this.rps += 0.5 * ((cum1 - e1) ** 2 + (cum2 - e2) ** 2);
    // multiclass Brier
    const yH = o === 'H' ? 1 : 0;
    const yD = o === 'D' ? 1 : 0;
    const yA = o === 'A' ? 1 : 0;
    this.brier += (p.H - yH) ** 2 + (p.D - yD) ** 2 + (p.A - yA) ** 2;
    // accuracy
    const pred = p.H >= p.D && p.H >= p.A ? 'H' : p.D >= p.A ? 'D' : 'A';
    if (pred === o) this.correct++;
    // calibration bucket
    let b = Math.floor(p.H * BINS);
    if (b >= BINS) b = BINS - 1;
    this.binPred[b] += p.H;
    this.binObs[b] += yH;
    this.binN[b]++;
  }

  row(): string {
    const f = (x: number) => x.toFixed(4);
    return [
      String(this.n).padStart(6),
      f(this.rps / this.n).padStart(8),
      f(this.logloss / this.n).padStart(9),
      f(this.brier / this.n).padStart(8),
      ((this.correct / this.n) * 100).toFixed(1).padStart(7) + '%',
    ].join('  ');
  }

  calibration(): string {
    const lines = ['  bin   pred    obs      n'];
    for (let b = 0; b < BINS; b++) {
      if (this.binN[b] === 0) continue;
      const lo = (b / BINS).toFixed(1);
      const hi = ((b + 1) / BINS).toFixed(1);
      const pred = (this.binPred[b] / this.binN[b]).toFixed(3);
      const obs = (this.binObs[b] / this.binN[b]).toFixed(3);
      lines.push(`  ${lo}-${hi}  ${pred}  ${obs}  ${String(this.binN[b]).padStart(5)}`);
    }
    return lines.join('\n');
  }
}

// --- walk-forward loop ------------------------------------------------------
function main(): void {
  if (!existsSync(CSV_PATH)) {
    console.error('data/results.csv not found. Run `npm run build:elo` once to download it.');
    process.exit(1);
  }
  const rows = parseCsv(readFileSync(CSV_PATH, 'utf8'));

  const hasSquad = squadDataAvailable();
  const dc = new DixonColesOnline();
  const squad = new SquadModel();
  const ensemble = new EnsembleModel(dc, squad, 0.5);
  // base models update their internal state; calibrated wrappers reuse them.
  const base: Predictor[] = [dc, new EloPoissonModel(), new BaseRateModel()];
  if (hasSquad) base.push(squad, ensemble);
  const dcCal = new CalibratedModel(dc);
  const calibrated: CalibratedModel[] = [dcCal];
  // calibrated wrappers are scored like any model, but don't update base state
  const models: Predictor[] = [...base, ...calibrated];
  // Squad strength only exists from 2014, so it can't fit its constant on the
  // pre-VALID prefix like the others; let it train through to EVAL_START.
  const lateFreeze = new Set<Predictor>(hasSquad ? [squad] : []);

  // one metrics bucket per model, for all eval games and competitive-only games
  const all = models.map(() => new Metrics());
  const comp = models.map(() => new Metrics());
  // fair head-to-head on the SAME matches the squad model can rate (both teams
  // have a FIFA pool and it's competitive): does adding squad info beat DC alone?
  const matchedNames = ['Dixon-Coles only', 'Squad only', 'Ensemble (DC+squad)'];
  const matched = matchedNames.map(() => new Metrics());

  let constFrozen = false;
  let lateFrozen = false;
  let calFrozen = false;
  let evalCount = 0;
  for (const r of rows) {
    const inValid = r.date >= VALID_START && r.date < EVAL_START;
    const inEval = r.date >= EVAL_START;
    // 1) freeze most model constants once the training prefix ends...
    if (r.date >= VALID_START && !constFrozen) {
      for (const m of base) if (!lateFreeze.has(m)) m.freeze();
      constFrozen = true;
    }
    // 2) collect validation predictions to fit recalibration
    if (inValid) {
      const o = outcomeOf(r.hs, r.as);
      for (const c of calibrated) c.collect(r, o);
    }
    // 3) ...but late-freeze models (squad) train right up to the test window
    if (inEval && !lateFrozen) {
      for (const m of base) if (lateFreeze.has(m)) m.freeze();
      lateFrozen = true;
    }
    // 4) freeze recalibration once the validation window ends
    if (inEval && !calFrozen) {
      for (const c of calibrated) c.freeze();
      calFrozen = true;
    }
    if (inEval) {
      evalCount++;
      const o = outcomeOf(r.hs, r.as);
      const competitive = r.tournament.toLowerCase() !== 'friendly';
      models.forEach((m, i) => {
        const p = m.predict(r);
        if (!p) return;
        all[i].add(p, o);
        if (competitive) comp[i].add(p, o);
      });
      if (hasSquad && competitive) {
        const pDc = dc.predict(r);
        const pSq = squad.predict(r);
        const pEn = ensemble.predict(r);
        if (pDc && pSq && pEn) {
          matched[0].add(pDc, o);
          matched[1].add(pSq, o);
          matched[2].add(pEn, o);
        }
      }
    }
    // each base model accumulates fit stats up to its own freeze point
    for (const m of base) {
      const cutoff = lateFreeze.has(m) ? EVAL_START : VALID_START;
      m.update(r, r.date < cutoff);
    }
  }

  const header =
    '       n       RPS    logloss     Brier      acc   model';
  console.log(`\nWalk-forward backtest  (constants <${VALID_START} | calibrate ${VALID_START}..${EVAL_START} | test ${EVAL_START}+)`);
  console.log(`Total matches: ${rows.length.toLocaleString()}  |  in test window: ${evalCount.toLocaleString()}`);
  console.log(`Fitted recalibration temperature: ${calibrated.map((c) => `${c.name.replace(' + recalibration', '')}=${c.T.toFixed(3)}`).join(', ')}`);
  console.log('Lower RPS / log-loss / Brier is better. Accuracy shown for intuition only.\n');

  console.log('ALL evaluation matches');
  console.log(header);
  models.forEach((m, i) => console.log(`${all[i].row()}  ${m.name}`));

  console.log('\nCOMPETITIVE matches only (friendlies excluded)');
  console.log(header);
  models.forEach((m, i) => console.log(`${comp[i].row()}  ${m.name}`));

  if (hasSquad) {
    console.log('\nSQUAD-VALUE TEST -- competitive matches both teams have a FIFA pool for');
    console.log('(identical match set for all three rows, so RPS is directly comparable)');
    console.log(header);
    matched.forEach((m, i) => console.log(`${m.row()}  ${matchedNames[i]}`));
  }

  const dcCalIdx = base.length; // first calibrated wrapper = recalibrated DC
  console.log('\nCalibration of home-win probability (pred should track obs)');
  console.log(`-- before: ${models[0].name}`);
  console.log(all[0].calibration());
  console.log(`-- after:  ${models[dcCalIdx].name}`);
  console.log(all[dcCalIdx].calibration());
  console.log('');
}

main();
