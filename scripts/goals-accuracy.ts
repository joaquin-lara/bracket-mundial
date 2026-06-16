/**
 * How well does the model predict GOALS (not just win/draw/loss)?
 * Every other test scores the W/D/L outcome; this one scores the scoreline.
 * Walk-forward, competitive test matches (2018+). Dixon-Coles goal means vs a
 * naive constant-average baseline.
 *
 *   tsx scripts/goals-accuracy.ts
 */
import { readFileSync } from 'fs';
import path from 'path';
import { scoreGrid } from '../src/lib/ml/poisson';

const CSV = path.join(process.cwd(), 'data', 'results.csv');
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

class DC {
  att = new Map<string, number>(); def = new Map<string, number>(); played = new Map<string, number>();
  base = Math.log(1.35); home = 0.25; rho = -0.07; lrTeam = 0.05; lrGlobal = 0.004; shrink = 0.0015;
  private a(t: string) { return this.att.get(t) ?? 0; }
  private d(t: string) { return this.def.get(t) ?? 0; }
  means(r: Row): [number, number] {
    return [Math.exp(this.base + (r.neutral ? 0 : this.home) + this.a(r.home) - this.d(r.away)), Math.exp(this.base + this.a(r.away) - this.d(r.home))];
  }
  ready(r: Row) { return (this.played.get(r.home) ?? 0) >= MIN_HISTORY && (this.played.get(r.away) ?? 0) >= MIN_HISTORY; }
  update(r: Row) {
    const [lh, la] = this.means(r);
    const w = r.tournament.toLowerCase() === 'friendly' ? 0.5 : 1;
    const eh = r.hs - lh, ea = r.as - la, lr = this.lrTeam * w, s = this.shrink;
    this.att.set(r.home, this.a(r.home) * (1 - s) + lr * eh);
    this.def.set(r.away, this.d(r.away) * (1 - s) - lr * eh);
    this.att.set(r.away, this.a(r.away) * (1 - s) + lr * ea);
    this.def.set(r.home, this.d(r.home) * (1 - s) - lr * ea);
    this.base += this.lrGlobal * w * (eh + ea);
    if (!r.neutral) this.home += this.lrGlobal * w * eh;
    this.played.set(r.home, (this.played.get(r.home) ?? 0) + 1);
    this.played.set(r.away, (this.played.get(r.away) ?? 0) + 1);
  }
  // tau-corrected probability of an exact scoreline
  scoreProb(lh: number, la: number): Map<string, number> {
    const g = scoreGrid(lh, la, MAX_GOALS);
    const m = new Map<string, number>(); let tot = 0;
    for (const c of g.cells) {
      let f = 1;
      if (c.home === 0 && c.away === 0) f = 1 - lh * la * this.rho;
      else if (c.home === 0 && c.away === 1) f = 1 + lh * this.rho;
      else if (c.home === 1 && c.away === 0) f = 1 + la * this.rho;
      else if (c.home === 1 && c.away === 1) f = 1 - this.rho;
      const p = Math.max(1e-12, c.prob * f); m.set(`${c.home}-${c.away}`, p); tot += p;
    }
    for (const k of m.keys()) m.set(k, m.get(k)! / tot);
    return m;
  }
}

const dc = new DC();
let n = 0, maeTot = 0, maeHome = 0, maeAway = 0, maeBase = 0, sllDC = 0, hit = 0, within1 = 0;
let sumTot = 0, nBase = 0;
// first pass to get the global average total for the naive baseline
for (const r of rows) if (r.date >= EVAL_START && r.tournament.toLowerCase() !== 'friendly') { sumTot += r.hs + r.as; nBase++; }
const avgTotal = sumTot / nBase, avgHalf = avgTotal / 2;

for (const r of rows) {
  const comp = r.tournament.toLowerCase() !== 'friendly';
  if (r.date >= EVAL_START && comp && dc.ready(r)) {
    const [lh, la] = dc.means(r);
    n++;
    maeHome += Math.abs(lh - r.hs);
    maeAway += Math.abs(la - r.as);
    maeTot += Math.abs(lh + la - (r.hs + r.as));
    maeBase += Math.abs(avgTotal - (r.hs + r.as)); // naive: always predict the average total
    const sp = dc.scoreProb(lh, la);
    const key = `${Math.min(r.hs, MAX_GOALS)}-${Math.min(r.as, MAX_GOALS)}`;
    sllDC += -Math.log(sp.get(key) ?? 1e-9);
    let bestK = '', bestP = -1;
    for (const [k, p] of sp) if (p > bestP) { bestP = p; bestK = k; }
    if (bestK === `${r.hs}-${r.as}`) hit++;
    if (Math.abs(lh + la - (r.hs + r.as)) <= 1) within1++;
  }
  dc.update(r);
}

const f = (x: number) => x.toFixed(3);
console.log(`Goal accuracy on ${n} competitive test matches (2018+). Avg actual total = ${avgTotal.toFixed(2)} goals.\n`);
console.log(`Expected-goals error (mean absolute error, goals):`);
console.log(`  total goals   DC ${f(maeTot / n)}   vs naive-average ${f(maeBase / n)}`);
console.log(`  home goals    DC ${f(maeHome / n)}`);
console.log(`  away goals    DC ${f(maeAway / n)}`);
console.log(`\nScoreline:`);
console.log(`  exact-scoreline log-loss   ${f(sllDC / n)}  (lower better)`);
console.log(`  most-likely scoreline hit  ${(100 * hit / n).toFixed(1)}%`);
console.log(`  total within +/-1 goal     ${(100 * within1 / n).toFixed(1)}%`);
console.log(`\nNote: the live W/D/L blend does NOT change these -- goals come purely from Dixon-Coles.`);
