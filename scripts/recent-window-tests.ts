/**
 * Hypothesis: the rejected features (squad, altitude, rest, travel) failed
 * because 150 years of old football drowned their signal. Re-test each on a
 * RECENT-only training window (2012+) vs full history, same validation/test
 * split, to see if recency unlocks anything. Tune coef on validation
 * [2018,2020), score on test [2020,+). Competitive matches only.
 *
 *   tsx scripts/recent-window-tests.ts
 */
import { readFileSync } from 'fs';
import path from 'path';
import { scoreGrid } from '../src/lib/ml/poisson';
import { strengthAsOf, squadDataAvailable } from './squad-strength';

const CSV = path.join(process.cwd(), 'data', 'results.csv');
const VALID = '2018-01-01', EVAL = '2020-01-01';
const MAX_GOALS = 8, MIN_HISTORY = 5, HOME_ADV = 100;

interface Row { date: string; home: string; away: string; hs: number; as: number; tournament: string; neutral: boolean; city: string; country: string; }
const allRows: Row[] = [];
for (const line of readFileSync(CSV, 'utf8').split(/\r?\n/).slice(1)) {
  const c = line.split(',');
  if (c.length < 9) continue;
  const hs = Number(c[3]), as = Number(c[4]);
  if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
  allRows.push({ date: c[0], home: c[1], away: c[2], hs, as, tournament: c[5], city: c[6], country: c[7], neutral: c[8].trim().toUpperCase() === 'TRUE' });
}
allRows.sort((a, b) => a.date.localeCompare(b.date));

function norm(s: string) { return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
const ALT_M: Record<string, number> = { lapaz: 3640, elalto: 4150, oruro: 3706, sucre: 2810, cochabamba: 2558, quito: 2850, cusco: 3399, bogota: 2640, mexicocity: 2240, toluca: 2660, pachuca: 2400, puebla: 2135, addisababa: 2355, johannesburg: 1753, pretoria: 1339, nairobi: 1795, sanaa: 2250, tehran: 1200 };
const altKm = (c: string) => { const m = ALT_M[norm(c)]; return m && m >= 1000 ? m / 1000 : 0; };
const CO: Record<string, [number, number]> = { brazil: [-10, -55], argentina: [-34, -64], uruguay: [-33, -56], colombia: [4, -72], chile: [-30, -71], peru: [-10, -76], ecuador: [-1.5, -78.5], paraguay: [-23, -58], bolivia: [-17, -65], venezuela: [7, -66], england: [52.4, -1.5], france: [46.6, 2.2], germany: [51, 10.4], spain: [40.2, -3.6], italy: [42.8, 12.6], netherlands: [52.1, 5.3], portugal: [39.6, -8], belgium: [50.6, 4.6], croatia: [45.1, 15.2], mexico: [23, -102], unitedstates: [39, -98], canada: [56, -106], japan: [36, 138], southkorea: [36.5, 127.8], australia: [-25, 133], iran: [32, 53], saudiarabia: [24, 45], qatar: [25.3, 51.2], nigeria: [9, 8], egypt: [26, 30], senegal: [14.5, -14.4], morocco: [32, -6], ghana: [8, -1], cameroon: [6, 12], cotedivoire: [7.5, -5.5] };
const ALIASCO: Record<string, string> = { korearepublic: 'southkorea', iriran: 'iran', usa: 'unitedstates', ivorycoast: 'cotedivoire' };
const coord = (n: string) => CO[ALIASCO[norm(n)] ?? norm(n)] ?? null;
function dist(a: [number, number], b: [number, number]) { const R = 6371, t = (x: number) => x * Math.PI / 180; const dLa = t(b[0] - a[0]), dLo = t(b[1] - a[1]); const s = Math.sin(dLa / 2) ** 2 + Math.cos(t(a[0])) * Math.cos(t(b[0])) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); }
const awayTravel = (r: Row) => { const a = coord(r.away), c = coord(r.country); return a && c ? dist(a, c) : 0; };
const homeTravel = (r: Row) => { if (!r.neutral) return 0; const h = coord(r.home), c = coord(r.country); return h && c ? dist(h, c) : 0; };

type O = 'H' | 'D' | 'A';
const oc = (h: number, a: number): O => (h > a ? 'H' : h < a ? 'A' : 'D');
interface P { H: number; D: number; A: number; }
const rps = (p: P, o: O) => { const c1 = p.H, c2 = p.H + p.D, e1 = o === 'H' ? 1 : 0, e2 = o === 'A' ? 0 : 1; return 0.5 * ((c1 - e1) ** 2 + (c2 - e2) ** 2); };
interface Acc { s: number; n: number; }
const mk = (): Acc => ({ s: 0, n: 0 });
const ad = (a: Acc, p: P, o: O) => { a.s += rps(p, o); a.n++; };
const rp = (a: Acc) => a.s / a.n;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

interface Cfg { altCoef: number; restCoef: number; travelCoef: number; }
class DC {
  att = new Map<string, number>(); def = new Map<string, number>(); played = new Map<string, number>(); last = new Map<string, string>();
  base = Math.log(1.35); home = 0.25; rho = -0.07; lrTeam = 0.05; lrGlobal = 0.004; shrink = 0.0015;
  constructor(private cfg: Cfg) {}
  private a(t: string) { return this.att.get(t) ?? 0; }
  private d(t: string) { return this.def.get(t) ?? 0; }
  private rest(t: string, dt: string) { const l = this.last.get(t); return l ? (Date.parse(dt) - Date.parse(l)) / 86400000 : null; }
  private means(r: Row): [number, number] {
    let ha = r.neutral ? 0 : this.home;
    if (!r.neutral) ha += this.cfg.altCoef * altKm(r.city);
    let lh = Math.exp(this.base + ha + this.a(r.home) - this.d(r.away)), la = Math.exp(this.base + this.a(r.away) - this.d(r.home));
    let S = 0;
    if (this.cfg.restCoef) { const hr = this.rest(r.home, r.date), ar = this.rest(r.away, r.date); if (hr != null && ar != null) S += this.cfg.restCoef * (clamp(hr, 0, 10) - clamp(ar, 0, 10)); }
    if (this.cfg.travelCoef) S += this.cfg.travelCoef * (awayTravel(r) - homeTravel(r)) / 1000;
    if (S) { lh *= Math.exp(S / 2); la *= Math.exp(-S / 2); }
    return [lh, la];
  }
  ready(r: Row) { return (this.played.get(r.home) ?? 0) >= MIN_HISTORY && (this.played.get(r.away) ?? 0) >= MIN_HISTORY; }
  predict(r: Row): P | null {
    if (!this.ready(r)) return null;
    const [lh, la] = this.means(r);
    const g = scoreGrid(lh, la, MAX_GOALS);
    let pH = 0, pD = 0, pA = 0, tot = 0;
    for (const c of g.cells) { let f = 1; if (c.home === 0 && c.away === 0) f = 1 - lh * la * this.rho; else if (c.home === 0 && c.away === 1) f = 1 + lh * this.rho; else if (c.home === 1 && c.away === 0) f = 1 + la * this.rho; else if (c.home === 1 && c.away === 1) f = 1 - this.rho; const p = Math.max(0, c.prob * f); tot += p; if (c.home > c.away) pH += p; else if (c.home === c.away) pD += p; else pA += p; }
    return { H: pH / tot, D: pD / tot, A: pA / tot };
  }
  update(r: Row) {
    const [lh, la] = this.means(r); const w = r.tournament.toLowerCase() === 'friendly' ? 0.5 : 1;
    const eh = r.hs - lh, ea = r.as - la, lr = this.lrTeam * w, s = this.shrink;
    this.att.set(r.home, this.a(r.home) * (1 - s) + lr * eh); this.def.set(r.away, this.d(r.away) * (1 - s) - lr * eh);
    this.att.set(r.away, this.a(r.away) * (1 - s) + lr * ea); this.def.set(r.home, this.d(r.home) * (1 - s) - lr * ea);
    this.base += this.lrGlobal * w * (eh + ea); if (!r.neutral) this.home += this.lrGlobal * w * eh;
    this.played.set(r.home, (this.played.get(r.home) ?? 0) + 1); this.played.set(r.away, (this.played.get(r.away) ?? 0) + 1);
    this.last.set(r.home, r.date); this.last.set(r.away, r.date);
  }
}

// Squad-strength model (Elo-style on FIFA talent pool), fit on a training prefix.
class Squad {
  sDX = 0; sSq = 0; sT = 0; n = 0; gps = 0; avg = 0; frozen = false;
  gap(r: Row) { const h = strengthAsOf(r.home, r.date), a = strengthAsOf(r.away, r.date); return h == null || a == null ? null : h - a; }
  predict(r: Row): P | null { if (!this.frozen) return null; const g = this.gap(r); if (g == null) return null; const sup = g * this.gps, half = this.avg / 2; const grid = scoreGrid(Math.max(0.15, half + sup / 2), Math.max(0.15, half - sup / 2), MAX_GOALS); return { H: grid.pHome, D: grid.pDraw, A: grid.pAway }; }
  fit(r: Row) { const g = this.gap(r); if (g == null) return; this.sDX += g * (r.hs - r.as); this.sSq += g * g; this.sT += r.hs + r.as; this.n++; }
  freeze() { this.gps = this.sDX / this.sSq; this.avg = this.sT / this.n; this.frozen = true; }
}
class Elo {
  elo = new Map<string, number>(); played = new Map<string, number>(); sDX = 0; sSq = 0; sT = 0; n = 0;
  g(t: string) { return this.elo.get(t) ?? 1500; }
  predict(r: Row): P | null { if (this.n < 300) return null; if ((this.played.get(r.home) ?? 0) < MIN_HISTORY || (this.played.get(r.away) ?? 0) < MIN_HISTORY) return null; const gpe = this.sDX / this.sSq, avg = this.sT / this.n, gap = this.g(r.home) - this.g(r.away) + (r.neutral ? 0 : HOME_ADV), sup = gap * gpe, half = avg / 2; const g = scoreGrid(Math.max(0.15, half + sup / 2), Math.max(0.15, half - sup / 2), MAX_GOALS); return { H: g.pHome, D: g.pDraw, A: g.pAway }; }
  update(r: Row) { const kf = r.tournament.toLowerCase() === 'friendly' ? 20 : 40, gap = this.g(r.home) - this.g(r.away) + (r.neutral ? 0 : HOME_ADV), expH = 1 / (1 + Math.pow(10, -gap / 400)), resH = r.hs > r.as ? 1 : r.hs < r.as ? 0 : 0.5, m = Math.abs(r.hs - r.as) <= 1 ? 1 : Math.abs(r.hs - r.as) === 2 ? 1.5 : (11 + Math.abs(r.hs - r.as)) / 8, delta = kf * m * (resH - expH); this.elo.set(r.home, this.g(r.home) + delta); this.elo.set(r.away, this.g(r.away) - delta); this.played.set(r.home, (this.played.get(r.home) ?? 0) + 1); this.played.set(r.away, (this.played.get(r.away) ?? 0) + 1); this.sDX += gap * (r.hs - r.as); this.sSq += gap * gap; this.sT += r.hs + r.as; this.n++; }
}

const comp = (r: Row) => r.tournament.toLowerCase() !== 'friendly';

// generic single-feature DC sweep: tune coef on validation, report test + subset
function sweepDC(start: string, key: 'altCoef' | 'restCoef' | 'travelCoef', coefs: number[], sub: (r: Row) => boolean) {
  let best = 0, bestVal = Infinity, baseTest = 0, baseSub = 0;
  const results: { coef: number; test: number; sub: number }[] = [];
  for (const coef of coefs) {
    const dc = new DC({ altCoef: 0, restCoef: 0, travelCoef: 0, [key]: coef } as Cfg);
    const val = mk(), test = mk(), subA = mk();
    for (const r of allRows) {
      if (r.date < start) continue;
      if (comp(r)) { const p = dc.predict(r); if (p) { const o = oc(r.hs, r.as); if (r.date >= VALID && r.date < EVAL) ad(val, p, o); else if (r.date >= EVAL) { ad(test, p, o); if (sub(r)) ad(subA, p, o); } } }
      dc.update(r);
    }
    const v = rp(val); results.push({ coef, test: rp(test), sub: subA.n ? rp(subA) : NaN });
    if (coef === 0) { baseTest = rp(test); baseSub = subA.n ? rp(subA) : NaN; }
    if (v < bestVal) { bestVal = v; best = coef; }
  }
  const bestR = results.find(r => r.coef === best)!;
  return { best, baseTest, bestTest: bestR.test, baseSub, bestSub: bestR.sub, subN: 0 };
}

function squadEnsemble(start: string) {
  // fit squad on [start, VALID); blend DC+squad on the squad-covered test subset
  const dc = new DC({ altCoef: 0, restCoef: 0, travelCoef: 0 }); const sq = new Squad();
  let froze = false;
  const W = [0, 0.1, 0.2, 0.3, 0.4, 0.5]; // weight on squad
  const val = W.map(mk), test = W.map(mk);
  for (const r of allRows) {
    if (r.date < start) continue;
    if (r.date >= VALID && !froze) { sq.freeze(); froze = true; }
    if (comp(r)) {
      const pd = dc.predict(r), ps = sq.predict(r);
      if (pd && ps) { const o = oc(r.hs, r.as); W.forEach((w, i) => { const p = { H: (1 - w) * pd.H + w * ps.H, D: (1 - w) * pd.D + w * ps.D, A: (1 - w) * pd.A + w * ps.A }; if (r.date >= VALID && r.date < EVAL) ad(val[i], p, o); else if (r.date >= EVAL) ad(test[i], p, o); }); }
    }
    dc.update(r); if (r.date < VALID) sq.fit(r);
  }
  let bi = 0; W.forEach((_, i) => { if (rp(val[i]) < rp(val[bi])) bi = i; });
  return { bestW: W[bi], baseTest: rp(test[0]), bestTest: rp(test[bi]), n: test[0].n };
}

function eloBlend(start: string) {
  const dc = new DC({ altCoef: 0, restCoef: 0, travelCoef: 0 }); const elo = new Elo();
  const W = [0, 0.2, 0.3, 0.4, 0.5];
  const val = W.map(mk), test = W.map(mk);
  for (const r of allRows) {
    if (r.date < start) continue;
    if (comp(r)) { const pd = dc.predict(r), pe = elo.predict(r); if (pd && pe) { const o = oc(r.hs, r.as); W.forEach((w, i) => { const p = { H: (1 - w) * pd.H + w * pe.H, D: (1 - w) * pd.D + w * pe.D, A: (1 - w) * pd.A + w * pe.A }; if (r.date >= VALID && r.date < EVAL) ad(val[i], p, o); else if (r.date >= EVAL) ad(test[i], p, o); }); } }
    dc.update(r); elo.update(r);
  }
  let bi = 0; W.forEach((_, i) => { if (rp(val[i]) < rp(val[bi])) bi = i; });
  return { bestW: W[bi], baseTest: rp(test[0]), bestTest: rp(test[bi]), n: test[0].n };
}

const f = (x: number) => (Number.isNaN(x) ? ' n/a ' : x.toFixed(4));
const d = (b: number, t: number) => (Number.isNaN(t) ? '' : `${t < b ? 'BETTER' : t > b ? 'worse ' : 'same  '} ${(b - t >= 0 ? '+' : '') + (b - t).toFixed(4)}`);
console.log(`squadData=${squadDataAvailable()}  | tune [${VALID},${EVAL})  test [${EVAL},+)  competitive only\n`);
for (const start of ['1872-01-01', '2012-01-01']) {
  console.log(`================  TRAIN FROM ${start.slice(0, 4)}  ================`);
  const alt = sweepDC(start, 'altCoef', [0, 0.05, 0.1, 0.15, 0.2], (r) => !r.neutral && altKm(r.city) > 0);
  console.log(`Altitude   best altCoef=${alt.best}  test ${f(alt.baseTest)}->${f(alt.bestTest)} ${d(alt.baseTest, alt.bestTest)}   | altitude subset ${f(alt.baseSub)}->${f(alt.bestSub)} ${d(alt.baseSub, alt.bestSub)}`);
  const rest = sweepDC(start, 'restCoef', [0, 0.005, 0.01, 0.02, 0.04], () => false);
  console.log(`Rest       best restCoef=${rest.best}  test ${f(rest.baseTest)}->${f(rest.bestTest)} ${d(rest.baseTest, rest.bestTest)}`);
  const trav = sweepDC(start, 'travelCoef', [0, 0.01, 0.02, 0.04, 0.08], (r) => awayTravel(r) - homeTravel(r) > 3000);
  console.log(`Travel     best travelCoef=${trav.best}  test ${f(trav.baseTest)}->${f(trav.bestTest)} ${d(trav.baseTest, trav.bestTest)}   | longhaul subset ${f(trav.baseSub)}->${f(trav.bestSub)} ${d(trav.baseSub, trav.bestSub)}`);
  const sq = squadEnsemble(start);
  console.log(`Squad      best wSquad=${sq.bestW}  test ${f(sq.baseTest)}->${f(sq.bestTest)} ${d(sq.baseTest, sq.bestTest)}  (n=${sq.n} squad-covered)`);
  const eb = eloBlend(start);
  console.log(`Elo blend  best wElo=${eb.bestW}  test ${f(eb.baseTest)}->${f(eb.bestTest)} ${d(eb.baseTest, eb.bestTest)}  (n=${eb.n})`);
  console.log('');
}
