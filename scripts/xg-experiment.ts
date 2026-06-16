/**
 * Does training the ratings on xG (a less-noisy signal of performance) instead
 * of the actual scoreline help? Uses StatsBomb international xG (xg/statsbomb_xg
 * .json, ~314 tournament matches 2018-2024). Walk-forward DC; for matches that
 * have xG the rating update target is (1-alpha)*goals + alpha*xG. alpha=0 is the
 * shipped model. Scored on competitive test matches (2018+), W/D/L.
 *
 *   tsx scripts/xg-experiment.ts
 */
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { scoreGrid } from '../src/lib/ml/poisson';
import { countryKey } from './country-names';

const CSV = path.join(process.cwd(), 'data', 'results.csv');
const XG = path.join(process.cwd(), 'xg', 'statsbomb_xg.json');
const EVAL_START = '2018-01-01';
const MAX_GOALS = 8, MIN_HISTORY = 5;

interface Row { date: string; home: string; away: string; hs: number; as: number; tournament: string; neutral: boolean; }
const rows: Row[] = [];
for (const line of readFileSync(CSV, 'utf8').split(/\r?\n/).slice(1)) {
  const c = line.split(',');
  if (c.length < 9) continue;
  const hs = Number(c[3]), as = Number(c[4]);
  if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
  rows.push({ date: c[0], home: c[1], away: c[2], hs, as, tournament: c[5], neutral: c[8].trim().toUpperCase() === 'TRUE' });
}
rows.sort((a, b) => a.date.localeCompare(b.date));

// xG keyed per (date | canonical team), orientation-independent
const xgByTeam = new Map<string, number>();
let xgMatches = 0;
let higherXgWon = 0, higherXgDrew = 0, higherXgLost = 0;
if (existsSync(XG)) {
  const raw = JSON.parse(readFileSync(XG, 'utf8')) as Record<string, { date: string; home: string; away: string; homeScore: number; awayScore: number; homeXg: number; awayXg: number }>;
  for (const m of Object.values(raw)) {
    xgByTeam.set(`${m.date}|${countryKey(m.home)}`, m.homeXg);
    xgByTeam.set(`${m.date}|${countryKey(m.away)}`, m.awayXg);
    xgMatches++;
    // divergence stat: did the side with more xG win?
    if (Math.abs(m.homeXg - m.awayXg) > 0.01) {
      const favHome = m.homeXg > m.awayXg;
      const gd = m.homeScore - m.awayScore;
      const favGd = favHome ? gd : -gd;
      if (favGd > 0) higherXgWon++; else if (favGd === 0) higherXgDrew++; else higherXgLost++;
    }
  }
}
const xgOf = (team: string, date: string) => xgByTeam.get(`${date}|${countryKey(team)}`);

class DC {
  att = new Map<string, number>(); def = new Map<string, number>(); played = new Map<string, number>();
  base = Math.log(1.35); home = 0.25; rho = -0.07; lrTeam = 0.05; lrGlobal = 0.004; shrink = 0.0015;
  constructor(private alpha: number) {}
  private a(t: string) { return this.att.get(t) ?? 0; }
  private d(t: string) { return this.def.get(t) ?? 0; }
  private means(r: Row): [number, number] {
    return [Math.exp(this.base + (r.neutral ? 0 : this.home) + this.a(r.home) - this.d(r.away)), Math.exp(this.base + this.a(r.away) - this.d(r.home))];
  }
  ready(r: Row) { return (this.played.get(r.home) ?? 0) >= MIN_HISTORY && (this.played.get(r.away) ?? 0) >= MIN_HISTORY; }
  predict(r: Row) {
    if (!this.ready(r)) return null;
    const [lh, la] = this.means(r);
    const g = scoreGrid(lh, la, MAX_GOALS);
    let pH = 0, pD = 0, pA = 0, tot = 0;
    for (const c of g.cells) {
      let f = 1;
      if (c.home === 0 && c.away === 0) f = 1 - lh * la * this.rho;
      else if (c.home === 0 && c.away === 1) f = 1 + lh * this.rho;
      else if (c.home === 1 && c.away === 0) f = 1 + la * this.rho;
      else if (c.home === 1 && c.away === 1) f = 1 - this.rho;
      const p = Math.max(0, c.prob * f); tot += p;
      if (c.home > c.away) pH += p; else if (c.home === c.away) pD += p; else pA += p;
    }
    return { H: pH / tot, D: pD / tot, A: pA / tot };
  }
  update(r: Row) {
    const [lh, la] = this.means(r);
    const w = r.tournament.toLowerCase() === 'friendly' ? 0.5 : 1;
    // training target: blend actual goals with xG when xG is available
    let th = r.hs, ta = r.as;
    if (this.alpha > 0) {
      const xh = xgOf(r.home, r.date), xa = xgOf(r.away, r.date);
      if (xh != null && xa != null) { th = (1 - this.alpha) * r.hs + this.alpha * xh; ta = (1 - this.alpha) * r.as + this.alpha * xa; }
    }
    const eh = th - lh, ea = ta - la, lr = this.lrTeam * w, s = this.shrink;
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
type O = 'H' | 'D' | 'A';
const oc = (h: number, a: number): O => (h > a ? 'H' : h < a ? 'A' : 'D');
const rps = (p: { H: number; D: number; A: number }, o: O) => { const c1 = p.H, c2 = p.H + p.D, e1 = o === 'H' ? 1 : 0, e2 = o === 'A' ? 0 : 1; return 0.5 * ((c1 - e1) ** 2 + (c2 - e2) ** 2); };
const ll = (p: { H: number; D: number; A: number }, o: O) => -Math.log(Math.max(o === 'H' ? p.H : o === 'D' ? p.D : p.A, 1e-15));

console.log(`StatsBomb xG matches loaded: ${xgMatches}`);
const dec = higherXgWon + higherXgDrew + higherXgLost;
console.log(`Of decisive-xG matches, the higher-xG side: won ${(100 * higherXgWon / dec).toFixed(0)}%, drew ${(100 * higherXgDrew / dec).toFixed(0)}%, lost ${(100 * higherXgLost / dec).toFixed(0)}%`);
console.log(`(=> ${(100 * (higherXgDrew + higherXgLost) / dec).toFixed(0)}% of the time the "deserved" winner did NOT win -- that's the luck the scoreline carries.)\n`);

console.log('Training target = (1-alpha)*goals + alpha*xG for the 314 xG matches; scored on competitive test (2018+):');
for (const alpha of [0, 0.25, 0.5, 0.75, 1.0]) {
  const dc = new DC(alpha);
  let sR = 0, sL = 0, n = 0, matched = 0;
  for (const r of rows) {
    if (r.date >= EVAL_START && r.tournament.toLowerCase() !== 'friendly') {
      const p = dc.predict(r);
      if (p) { const o = oc(r.hs, r.as); sR += rps(p, o); sL += ll(p, o); n++; }
    }
    if (alpha > 0 && xgOf(r.home, r.date) != null && xgOf(r.away, r.date) != null) matched++;
    dc.update(r);
  }
  console.log(`  alpha=${alpha.toFixed(2)}  RPS ${(sR / n).toFixed(4)}  logloss ${(sL / n).toFixed(4)}  (n=${n}${alpha > 0 ? `, xG-trained updates=${matched}` : ', shipped model'})`);
}
