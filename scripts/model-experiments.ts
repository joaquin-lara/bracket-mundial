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

// --- country centroids (deg) for travel distance ----------------------------
const CENTROID: Record<string, [number, number]> = {
  england: [52.4, -1.5], france: [46.6, 2.2], germany: [51, 10.4], spain: [40.2, -3.6],
  italy: [42.8, 12.6], netherlands: [52.1, 5.3], portugal: [39.6, -8], belgium: [50.6, 4.6],
  croatia: [45.1, 15.2], serbia: [44, 21], switzerland: [46.8, 8.2], poland: [52.1, 19.4],
  sweden: [62, 15], denmark: [56, 9.5], norway: [64.5, 12], austria: [47.6, 14.1],
  ukraine: [49, 32], russia: [61.5, 105], turkey: [39, 35], greece: [39, 22],
  czechrepublic: [49.8, 15.5], wales: [52.3, -3.8], scotland: [56.8, -4.2], northernireland: [54.6, -6.5],
  republicofireland: [53.2, -8], romania: [45.9, 25], hungary: [47.2, 19.5], iceland: [65, -18],
  finland: [64, 26], bulgaria: [42.7, 25.5], slovakia: [48.7, 19.7], slovenia: [46, 14.8],
  brazil: [-10, -55], argentina: [-34, -64], uruguay: [-33, -56], colombia: [4, -72],
  chile: [-30, -71], peru: [-10, -76], ecuador: [-1.5, -78.5], paraguay: [-23, -58],
  bolivia: [-17, -65], venezuela: [7, -66],
  mexico: [23, -102], unitedstates: [39, -98], canada: [56, -106], costarica: [10, -84],
  honduras: [15, -86.5], panama: [9, -80], jamaica: [18.1, -77.3], elsalvador: [13.8, -88.9],
  guatemala: [15.7, -90.2], trinidadandtobago: [10.7, -61.2], haiti: [19, -72.4], curacao: [12.2, -69],
  nigeria: [9, 8], egypt: [26, 30], senegal: [14.5, -14.4], morocco: [32, -6], algeria: [28, 3],
  tunisia: [34, 9], ghana: [8, -1], cameroon: [6, 12], cotedivoire: [7.5, -5.5], mali: [17, -4],
  southafrica: [-29, 24], drcongo: [-3, 23], capeverde: [16, -24], burkinafaso: [12, -1.5],
  tanzania: [-6, 35], uganda: [1, 32], zambia: [-13, 28], kenya: [0, 38], ethiopia: [8, 38],
  guinea: [11, -10], gabon: [-0.6, 11.6], mauritania: [20, -10], angola: [-12, 18],
  madagascar: [-20, 47], equatorialguinea: [1.5, 10], mozambique: [-18, 35], botswana: [-22, 24],
  comoros: [-12, 44], namibia: [-22, 17], sudan: [15, 30], benin: [9.5, 2.3], togo: [8, 1.2],
  japan: [36, 138], southkorea: [36.5, 127.8], australia: [-25, 133], iran: [32, 53],
  saudiarabia: [24, 45], qatar: [25.3, 51.2], iraq: [33, 44], uae: [24, 54], china: [35, 103],
  uzbekistan: [41, 64], jordan: [31, 36], oman: [21, 57], syria: [35, 38], bahrain: [26, 50.5],
  vietnam: [16, 108], thailand: [15, 101], india: [22, 79], lebanon: [33.8, 35.8],
  kuwait: [29.3, 47.6], palestine: [31.9, 35.2], northkorea: [40, 127], newzealand: [-41, 174],
};
const COORD_ALIAS: Record<string, string> = {
  korearepublic: 'southkorea', iriran: 'iran', chinapr: 'china', unitedarabemirates: 'uae',
  ivorycoast: 'cotedivoire', usa: 'unitedstates', czechia: 'czechrepublic', turkiye: 'turkey',
  capeverdeislands: 'capeverde', congodr: 'drcongo', koreadpr: 'northkorea',
};
function coord(name: string): [number, number] | null {
  let k = norm(name);
  k = COORD_ALIAS[k] ?? k;
  return CENTROID[k] ?? null;
}
function dist(a: [number, number], b: [number, number]): number {
  const R = 6371, toR = (x: number) => (x * Math.PI) / 180;
  const dLat = toR(b[0] - a[0]), dLon = toR(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a[0])) * Math.cos(toR(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function awayTravelKm(r: Row): number {
  const a = coord(r.away), c = coord(r.country);
  return a && c ? dist(a, c) : 0;
}
function homeTravelKm(r: Row): number {
  if (!r.neutral) return 0; // home plays in its own country
  const h = coord(r.home), c = coord(r.country);
  return h && c ? dist(h, c) : 0;
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

interface DCConfig { lrTeam: number; shrink: number; friendlyWeight: number; altCoef: number; restCoef: number; travelCoef: number; }
const DC_DEFAULT: DCConfig = { lrTeam: 0.05, shrink: 0.0015, friendlyWeight: 0.5, altCoef: 0, restCoef: 0, travelCoef: 0 };
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

class DC {
  att = new Map<string, number>();
  def = new Map<string, number>();
  played = new Map<string, number>();
  base = Math.log(1.35);
  home = 0.25;
  rho = -0.07;
  lrGlobal = 0.004;
  lastDate = new Map<string, string>();
  constructor(private cfg: DCConfig) {}
  private a(t: string) { return this.att.get(t) ?? 0; }
  private d(t: string) { return this.def.get(t) ?? 0; }
  private rest(t: string, date: string): number | null {
    const last = this.lastDate.get(t);
    if (!last) return null;
    return (Date.parse(date) - Date.parse(last)) / 86400000;
  }
  // extra home-supremacy shift (log-goal space) from rest/travel asymmetry
  private extraSupremacy(r: Row): number {
    let S = 0;
    if (this.cfg.restCoef) {
      const hr = this.rest(r.home, r.date), ar = this.rest(r.away, r.date);
      if (hr != null && ar != null) S += this.cfg.restCoef * (clamp(hr, 0, 10) - clamp(ar, 0, 10));
    }
    if (this.cfg.travelCoef) S += this.cfg.travelCoef * (awayTravelKm(r) - homeTravelKm(r)) / 1000;
    return S;
  }
  private means(r: Row): [number, number] {
    let homeAdv = r.neutral ? 0 : this.home;
    if (!r.neutral) homeAdv += this.cfg.altCoef * altKm(r.city); // acclimatised host
    let lh = Math.exp(this.base + homeAdv + this.a(r.home) - this.d(r.away));
    let la = Math.exp(this.base + this.a(r.away) - this.d(r.home));
    const S = this.extraSupremacy(r);
    if (S) { lh *= Math.exp(S / 2); la *= Math.exp(-S / 2); }
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
    this.lastDate.set(r.home, r.date);
    this.lastDate.set(r.away, r.date);
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
// restricted to a subset of interest (default: the altitude matches).
const altSub = (r: Row) => !r.neutral && altKm(r.city) > 0;
function runDC(cfg: DCConfig, sub: (r: Row) => boolean = altSub, startDate = '1872-01-01'): { val: Acc; test: Acc; testSub: Acc } {
  const dc = new DC(cfg);
  const val = mk(), test = mk(), testSub = mk();
  for (const r of rows) {
    if (r.date < startDate) continue; // only learn from matches on/after the cutoff
    if (comp(r)) {
      const p = dc.predict(r);
      if (p) {
        const o = outcome(r.hs, r.as);
        if (r.date >= VALID_START && r.date < EVAL_START) add(val, p, o);
        else if (r.date >= EVAL_START) {
          add(test, p, o);
          if (sub(r)) add(testSub, p, o);
        }
      }
    }
    dc.update(r);
  }
  return { val, test, testSub };
}

console.log(`Tune on [${VALID_START}, ${EVAL_START}); test on [${EVAL_START}, +). Competitive only.\n`);
const baseRun = runDC(DC_DEFAULT);
console.log('Baseline DC (shipped):            ', show(baseRun.test));
console.log('  on altitude subset (>=1000m):   ', show(baseRun.testSub), '\n');

// --- Test 1: altitude home-advantage boost ----------------------------------
console.log('=== Test 1: altitude home advantage (tune altCoef on validation) ===');
let bestAlt = 0, bestAltVal = Infinity;
for (const altCoef of [0, 0.02, 0.04, 0.06, 0.08, 0.1, 0.15, 0.2]) {
  const r = runDC({ ...DC_DEFAULT, altCoef });
  const v = r.val.rps / r.val.n;
  console.log(`  altCoef=${altCoef.toFixed(2)}  val RPS ${v.toFixed(4)}  | test ${show(r.test)}  | testAlt ${show(r.testSub)}`);
  if (v < bestAltVal) { bestAltVal = v; bestAlt = altCoef; }
}
console.log(`  -> best validation altCoef=${bestAlt}`);

// --- Test 2: DC memory / weighting hyperparameters --------------------------
console.log('\n=== Test 2: DC hyperparameters (tune on validation) ===');
let bestCfg = DC_DEFAULT, bestVal = baseRun.val.rps / baseRun.val.n;
for (const lrTeam of [0.03, 0.05, 0.07])
  for (const shrink of [0.0005, 0.0015, 0.003])
    for (const friendlyWeight of [0.3, 0.5, 0.7, 1.0]) {
      const cfg = { ...DC_DEFAULT, lrTeam, shrink, friendlyWeight };
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

// --- Test 4: rest days (fatigue asymmetry) ----------------------------------
console.log('\n=== Test 4: rest-days advantage (tune restCoef on validation) ===');
for (const restCoef of [0, 0.005, 0.01, 0.02, 0.04]) {
  const r = runDC({ ...DC_DEFAULT, restCoef });
  console.log(`  restCoef=${restCoef.toFixed(3)}  val RPS ${(r.val.rps / r.val.n).toFixed(4)}  | test ${show(r.test)}`);
}

// --- Test 5: travel distance (away-team disadvantage) -----------------------
console.log('\n=== Test 5: travel distance (tune travelCoef on validation) ===');
const longHaul = (r: Row) => awayTravelKm(r) - homeTravelKm(r) > 3000;
for (const travelCoef of [0, 0.01, 0.02, 0.04, 0.08]) {
  const r = runDC({ ...DC_DEFAULT, travelCoef }, longHaul);
  console.log(`  travelCoef=${travelCoef.toFixed(2)}  val RPS ${(r.val.rps / r.val.n).toFixed(4)}  | test ${show(r.test)}  | longHaul(>3000km) ${show(r.testSub)}`);
}

// --- Test 6: training-data start cutoff (does old data dilute?) -------------
console.log('\n=== Test 6: training start cutoff (test window fixed 2018+) ===');
for (const start of ['1872-01-01', '1990-01-01', '2000-01-01', '2008-01-01', '2014-01-01']) {
  const r = runDC(DC_DEFAULT, altSub, start);
  console.log(`  train from ${start.slice(0, 4)}:  test ${show(r.test)}`);
}

// --- Test 7: friendly weight in training (0 = drop friendlies entirely) -----
console.log('\n=== Test 7: friendlies in training (friendlyWeight 0 = exclude) ===');
for (const fw of [0, 0.25, 0.5, 0.75, 1.0, 1.5]) {
  const r = runDC({ ...DC_DEFAULT, friendlyWeight: fw });
  console.log(`  friendlyWeight=${fw.toFixed(2)}  val RPS ${(r.val.rps / r.val.n).toFixed(4)}  | test ${show(r.test)}`);
}
