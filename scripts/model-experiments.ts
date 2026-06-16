/**
 * Out-of-sample experiments looking for signal that online Dixon-Coles misses.
 * Walk-forward (predict-before-update), competitive matches only, with a clean
 * tune/test split: hyperparameters/coefficients are chosen on the VALIDATION
 * window [VALID_START, EVAL_START) and scored on the TEST window [EVAL_START, +).
 *
 * Tests:
 *   1. Altitude home advantage  -- does a venue-altitude boost beat plain DC?
 *   2. DC memory / weighting     -- tune learning rate, decay, friendly weight.
 *   3. DC + Elo blend            -- does averaging the two models help?
 *
 *   tsx scripts/model-experiments.ts
 */
import { readFileSync } from 'fs';
import path from 'path';
import { scoreGrid } from '../src/lib/ml/poisson';

const CSV = path.join(process.cwd(), 'data', 'results.csv');
const VALID_START = '2013-01-01';
const EVAL_START = '2018-01-01';
const MAX_GOALS = 8;
const MIN_HISTORY = 5;
const HOME_ADV = 100;

interface Row {
  date: string;
  home: string;
  away: string;
  hs: number;
  as: number;
  tournament: string;
  neutral: boolean;
  city: string;
  country: string;
}

function parse(text: string): Row[] {
  const lines = text.split(/\r?\n/);
  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    if (c.length < 9) continue;
    const hs = Number(c[3]);
    const as = Number(c[4]);
    if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
    rows.push({
      date: c[0], home: c[1], away: c[2], hs, as, tournament: c[5],
      city: c[6], country: c[7], neutral: c[8].trim().toUpperCase() === 'TRUE',
    });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

// --- altitude lookup (metres) for cities that host internationals high up -----
function norm(s: string): string {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
const ALT_M: Record<string, number> = {
  lapaz: 3640, elalto: 4150, oruro: 3706, sucre: 2810, cochabamba: 2558, potosi: 4067,
  quito: 2850, cusco: 3399, arequipa: 2335, juliaca: 3825,
  bogota: 2640, medellin: 1495, tunja: 2820,
  mexicocity: 2240, toluca: 2660, pachuca: 2400, puebla: 2135, guadalajara: 1566,
  addisababa: 2355, asmara: 2325, nairobi: 1795, kampala: 1190, kigali: 1567,
  johannesburg: 1753, pretoria: 1339, harare: 1490, lusaka: 1279, windhoek: 1700,
  antananarivo: 1280, maseru: 1600, mbabane: 1243, gaborone: 1014, sanaa: 2250,
  tehran: 1200, kabul: 1790, thimphu: 2334, guatemalacity: 1500, sanjose: 1170,
  ulaanbaatar: 1300,
};
function altKm(city: string): number {
  const m = ALT_M[norm(city)];
  return m && m >= 1000 ? m / 1000 : 0;
}

type Outcome = 'H' | 'D' | 'A';
const outcome = (h: number, a: number): Outcome => (h > a ? 'H' : h < a ? 'A' : 'D');
interface Probs { H: number; D: number; A: number; }

function kFactor(t: string): number {
  const x = t.toLowerCase();
  if (x === 'fifa world cup') return 60;
  if (x.includes('world cup')) return 40;
  if (x.includes('confederations')) return 50;
  if (x.includes('uefa euro') || x.includes('copa américa') || x.includes('copa america') ||
    x.includes('african cup of nations') || x.includes('afc asian cup') || x.includes('gold cup') ||
    x.includes('nations league')) return x.includes('qualification') ? 40 : 50;
  if (x === 'friendly') return 20;
  return 30;
}
function marginMult(d: number): number {
  const m = Math.abs(d);
  if (m <= 1) return 1;
  if (m === 2) return 1.5;
  return (11 + m) / 8;
}

interface DCConfig { lrTeam: number; shrink: number; friendlyWeight: number; altCoef: number; }
const DC_DEFAULT: DCConfig = { lrTeam: 0.05, shrink: 0.0015, friendlyWeight: 0.5, altCoef: 0 };

class DC {
  att = new Map<string, number>();
  def = new Map<string, number>();
  played = new Map<string, number>();
  base = Math.log(1.35);
  home = 0.25;
  rho = -0.07;
  lrGlobal = 0.004;
  constructor(private cfg: DCConfig) {}
  private a(t: string) { return this.att.get(t) ?? 0; }
  private d(t: string) { return this.def.get(t) ?? 0; }
  private means(r: Row): [number, number] {
    let homeAdv = r.neutral ? 0 : this.home;
    if (!r.neutral) homeAdv += this.cfg.altCoef * altKm(r.city); // acclimatised host
    const lh = Math.exp(this.base + homeAdv + this.a(r.home) - this.d(r.away));
    const la = Math.exp(this.base + this.a(r.away) - this.d(r.home));
    return [lh, la];
  }
  predict(r: Row): Probs | null {
    if ((this.played.get(r.home) ?? 0) < MIN_HISTORY) return null;
    if ((this.played.get(r.away) ?? 0) < MIN_HISTORY) return null;
    const [lh, la] = this.means(r);
    const g = scoreGrid(lh, la, MAX_GOALS);
    let pH = 0, pD = 0, pA = 0, tot = 0;
    for (const c of g.cells) {
      let f = 1;
      if (c.home === 0 && c.away === 0) f = 1 - lh * la * this.rho;
      else if (c.home === 0 && c.away === 1) f = 1 + lh * this.rho;
      else if (c.home === 1 && c.away === 0) f = 1 + la * this.rho;
      else if (c.home === 1 && c.away === 1) f = 1 - this.rho;
      const p = Math.max(0, c.prob * f);
      tot += p;
      if (c.home > c.away) pH += p; else if (c.home === c.away) pD += p; else pA += p;
    }
    return { H: pH / tot, D: pD / tot, A: pA / tot };
  }
  update(r: Row): void {
    const [lh, la] = this.means(r);
    const w = r.tournament.toLowerCase() === 'friendly' ? this.cfg.friendlyWeight : 1;
    const eh = r.hs - lh, ea = r.as - la, lr = this.cfg.lrTeam * w, s = this.cfg.shrink;
    this.att.set(r.home, this.a(r.home) * (1 - s) + lr * eh);
    this.def.set(r.away, this.d(r.away) * (1 - s) - lr * eh);
    this.att.set(r.away, this.a(r.away) * (1 - s) + lr * ea);
    this.def.set(r.home, this.d(r.home) * (1 - s) - lr * ea);
    this.base += this.lrGlobal * w * (eh + ea);
    if (!r.neutral) this.home += this.lrGlobal * w * eh;
    this.played.set(r.home, (this.played.get(r.home) ?? 0) + 1);
    this.played.set(r.away, (this.played.get(r.away) ?? 0) + 1);
  }
}

class Elo {
  elo = new Map<string, number>();
  played = new Map<string, number>();
  sDX = 0; sSq = 0; sTot = 0; n = 0; gpe = 0; avg = 0; frozen = false;
  private g(t: string) { return this.elo.get(t) ?? 1500; }
  freeze() { this.gpe = this.sDX / this.sSq; this.avg = this.sTot / this.n; this.frozen = true; }
  predict(r: Row): Probs | null {
    if (!this.frozen) return null;
    if ((this.played.get(r.home) ?? 0) < MIN_HISTORY) return null;
    if ((this.played.get(r.away) ?? 0) < MIN_HISTORY) return null;
    const gap = this.g(r.home) - this.g(r.away) + (r.neutral ? 0 : HOME_ADV);
    const sup = gap * this.gpe, half = this.avg / 2;
    const lh = Math.max(0.15, half + sup / 2), la = Math.max(0.15, half - sup / 2);
    const g = scoreGrid(lh, la, MAX_GOALS);
    return { H: g.pHome, D: g.pDraw, A: g.pAway };
  }
  update(r: Row, inTrain: boolean): void {
    const gap = this.g(r.home) - this.g(r.away) + (r.neutral ? 0 : HOME_ADV);
    const expH = 1 / (1 + Math.pow(10, -gap / 400));
    const resH = r.hs > r.as ? 1 : r.hs < r.as ? 0 : 0.5;
    const delta = kFactor(r.tournament) * marginMult(r.hs - r.as) * (resH - expH);
    this.elo.set(r.home, this.g(r.home) + delta);
    this.elo.set(r.away, this.g(r.away) - delta);
    this.played.set(r.home, (this.played.get(r.home) ?? 0) + 1);
    this.played.set(r.away, (this.played.get(r.away) ?? 0) + 1);
    if (inTrain) { this.sDX += gap * (r.hs - r.as); this.sSq += gap * gap; this.sTot += r.hs + r.as; this.n++; }
  }
}

function rps(p: Probs, o: Outcome): number {
  const c1 = p.H, c2 = p.H + p.D, e1 = o === 'H' ? 1 : 0, e2 = o === 'A' ? 0 : 1;
  return 0.5 * ((c1 - e1) ** 2 + (c2 - e2) ** 2);
}
function ll(p: Probs, o: Outcome): number {
  const pa = o === 'H' ? p.H : o === 'D' ? p.D : p.A;
  return -Math.log(Math.max(pa, 1e-15));
}
interface Acc { rps: number; ll: number; n: number; }
const mk = (): Acc => ({ rps: 0, ll: 0, n: 0 });
const add = (a: Acc, p: Probs, o: Outcome) => { a.rps += rps(p, o); a.ll += ll(p, o); a.n++; };
const show = (a: Acc) => `RPS ${(a.rps / a.n).toFixed(4)}  logloss ${(a.ll / a.n).toFixed(4)}  n=${a.n}`;

const rows = parse(readFileSync(CSV, 'utf8'));
const comp = (r: Row) => r.tournament.toLowerCase() !== 'friendly';

// Run a DC config; return validation + test accumulators, plus a test accumulator
// restricted to the altitude subset (non-neutral matches >= 1000m).
function runDC(cfg: DCConfig): { val: Acc; test: Acc; testAlt: Acc } {
  const dc = new DC(cfg);
  const val = mk(), test = mk(), testAlt = mk();
  for (const r of rows) {
    if (comp(r)) {
      const p = dc.predict(r);
      if (p) {
        const o = outcome(r.hs, r.as);
        if (r.date >= VALID_START && r.date < EVAL_START) add(val, p, o);
        else if (r.date >= EVAL_START) {
          add(test, p, o);
          if (!r.neutral && altKm(r.city) > 0) add(testAlt, p, o);
        }
      }
    }
    dc.update(r);
  }
  return { val, test, testAlt };
}

console.log(`Tune on [${VALID_START}, ${EVAL_START}); test on [${EVAL_START}, +). Competitive only.\n`);
const baseRun = runDC(DC_DEFAULT);
console.log('Baseline DC (shipped):            ', show(baseRun.test));
console.log('  on altitude subset (>=1000m):   ', show(baseRun.testAlt), '\n');

// --- Test 1: altitude home-advantage boost ----------------------------------
console.log('=== Test 1: altitude home advantage (tune altCoef on validation) ===');
let bestAlt = 0, bestAltVal = Infinity;
for (const altCoef of [0, 0.02, 0.04, 0.06, 0.08, 0.1, 0.15, 0.2]) {
  const r = runDC({ ...DC_DEFAULT, altCoef });
  const v = r.val.rps / r.val.n;
  console.log(`  altCoef=${altCoef.toFixed(2)}  val RPS ${v.toFixed(4)}  | test ${show(r.test)}  | testAlt ${show(r.testAlt)}`);
  if (v < bestAltVal) { bestAltVal = v; bestAlt = altCoef; }
}
console.log(`  -> best validation altCoef=${bestAlt}`);

// --- Test 2: DC memory / weighting hyperparameters --------------------------
console.log('\n=== Test 2: DC hyperparameters (tune on validation) ===');
let bestCfg = DC_DEFAULT, bestVal = baseRun.val.rps / baseRun.val.n;
for (const lrTeam of [0.03, 0.05, 0.07])
  for (const shrink of [0.0005, 0.0015, 0.003])
    for (const friendlyWeight of [0.3, 0.5, 0.7, 1.0]) {
      const cfg = { lrTeam, shrink, friendlyWeight, altCoef: 0 };
      const r = runDC(cfg);
      const v = r.val.rps / r.val.n;
      if (v < bestVal) { bestVal = v; bestCfg = cfg; }
    }
console.log('  default cfg:', JSON.stringify(DC_DEFAULT), '-> test', show(baseRun.test));
console.log('  best val cfg:', JSON.stringify(bestCfg), '-> test', show(runDC(bestCfg).test));

// --- Test 3: DC + Elo blend -------------------------------------------------
console.log('\n=== Test 3: DC + Elo blend (tune weight on validation) ===');
{
  const dc = new DC(DC_DEFAULT);
  const elo = new Elo();
  let froze = false;
  const W = [0, 0.1, 0.2, 0.3, 0.4, 0.5];
  const val = W.map(mk), test = W.map(mk);
  for (const r of rows) {
    if (r.date >= VALID_START && !froze) { elo.freeze(); froze = true; }
    if (comp(r)) {
      const pd = dc.predict(r), pe = elo.predict(r);
      if (pd && pe) {
        const o = outcome(r.hs, r.as);
        W.forEach((w, i) => {
          const p = { H: (1 - w) * pd.H + w * pe.H, D: (1 - w) * pd.D + w * pe.D, A: (1 - w) * pd.A + w * pe.A };
          if (r.date >= VALID_START && r.date < EVAL_START) add(val[i], p, o);
          else if (r.date >= EVAL_START) add(test[i], p, o);
        });
      }
    }
    dc.update(r);
    elo.update(r, r.date < VALID_START);
  }
  let bi = 0;
  W.forEach((w, i) => {
    console.log(`  wElo=${w.toFixed(1)}  val RPS ${(val[i].rps / val[i].n).toFixed(4)}  | test ${show(test[i])}`);
    if (val[i].rps / val[i].n < val[bi].rps / val[bi].n) bi = i;
  });
  console.log(`  -> best validation wElo=${W[bi]} (wElo=0 is pure DC)`);
}
