/**
 * Rolling-window robustness check for the squad-strength ensemble -- the one
 * "rejected" feature that re-test (recent-window-tests.ts) showed is actually
 * window-dependent. Same method as rolling-validation.ts: replay once, online
 * DC + online squad model, fixed blend weights, score the FIFA-covered
 * competitive matches in six separate 2-year windows. If DC+squad beats DC in
 * most windows it is real; if only one or two, it is noise.
 *
 *   tsx scripts/squad-rolling.ts
 */
import { readFileSync } from 'fs';
import path from 'path';
import { scoreGrid } from '../src/lib/ml/poisson';
import { strengthAsOf } from './squad-strength';

const CSV = path.join(process.cwd(), 'data', 'results.csv');
const MAX_GOALS = 8, MIN_HISTORY = 5;
const BOUNDS = ['2014-01-01', '2016-01-01', '2018-01-01', '2020-01-01', '2022-01-01', '2024-01-01', '2026-01-01'];
const WEIGHTS = [0.3, 0.4]; // weight on the squad model

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

type O = 'H' | 'D' | 'A';
const oc = (h: number, a: number): O => (h > a ? 'H' : h < a ? 'A' : 'D');
interface P { H: number; D: number; A: number; }
const rps = (p: P, o: O) => { const c1 = p.H, c2 = p.H + p.D, e1 = o === 'H' ? 1 : 0, e2 = o === 'A' ? 0 : 1; return 0.5 * ((c1 - e1) ** 2 + (c2 - e2) ** 2); };

class DC {
  att = new Map<string, number>(); def = new Map<string, number>(); played = new Map<string, number>();
  base = Math.log(1.35); home = 0.25; rho = -0.07; lrTeam = 0.05; lrGlobal = 0.004; shrink = 0.0015;
  private a(t: string) { return this.att.get(t) ?? 0; }
  private d(t: string) { return this.def.get(t) ?? 0; }
  ready(r: Row) { return (this.played.get(r.home) ?? 0) >= MIN_HISTORY && (this.played.get(r.away) ?? 0) >= MIN_HISTORY; }
  predict(r: Row): P | null {
    if (!this.ready(r)) return null;
    const lh = Math.exp(this.base + (r.neutral ? 0 : this.home) + this.a(r.home) - this.d(r.away));
    const la = Math.exp(this.base + this.a(r.away) - this.d(r.home));
    const g = scoreGrid(lh, la, MAX_GOALS);
    let pH = 0, pD = 0, pA = 0, tot = 0;
    for (const c of g.cells) { let f = 1; if (c.home === 0 && c.away === 0) f = 1 - lh * la * this.rho; else if (c.home === 0 && c.away === 1) f = 1 + lh * this.rho; else if (c.home === 1 && c.away === 0) f = 1 + la * this.rho; else if (c.home === 1 && c.away === 1) f = 1 - this.rho; const p = Math.max(0, c.prob * f); tot += p; if (c.home > c.away) pH += p; else if (c.home === c.away) pD += p; else pA += p; }
    return { H: pH / tot, D: pD / tot, A: pA / tot };
  }
  update(r: Row) {
    const lh = Math.exp(this.base + (r.neutral ? 0 : this.home) + this.a(r.home) - this.d(r.away));
    const la = Math.exp(this.base + this.a(r.away) - this.d(r.home));
    const w = r.tournament.toLowerCase() === 'friendly' ? 0.5 : 1;
    const eh = r.hs - lh, ea = r.as - la, lr = this.lrTeam * w, s = this.shrink;
    this.att.set(r.home, this.a(r.home) * (1 - s) + lr * eh); this.def.set(r.away, this.d(r.away) * (1 - s) - lr * eh);
    this.att.set(r.away, this.a(r.away) * (1 - s) + lr * ea); this.def.set(r.home, this.d(r.home) * (1 - s) - lr * ea);
    this.base += this.lrGlobal * w * (eh + ea); if (!r.neutral) this.home += this.lrGlobal * w * eh;
    this.played.set(r.home, (this.played.get(r.home) ?? 0) + 1); this.played.set(r.away, (this.played.get(r.away) ?? 0) + 1);
  }
}
// online squad model: goals-per-strength-point fit from accumulated past matches
class Squad {
  sDX = 0; sSq = 0; sT = 0; n = 0;
  gap(r: Row) { const h = strengthAsOf(r.home, r.date), a = strengthAsOf(r.away, r.date); return h == null || a == null ? null : h - a; }
  predict(r: Row): P | null {
    if (this.n < 150) return null;
    const g = this.gap(r); if (g == null) return null;
    const gps = this.sDX / this.sSq, avg = this.sT / this.n, sup = g * gps, half = avg / 2;
    const grid = scoreGrid(Math.max(0.15, half + sup / 2), Math.max(0.15, half - sup / 2), MAX_GOALS);
    return { H: grid.pHome, D: grid.pDraw, A: grid.pAway };
  }
  update(r: Row) { const g = this.gap(r); if (g == null) return; this.sDX += g * (r.hs - r.as); this.sSq += g * g; this.sT += r.hs + r.as; this.n++; }
}
// online Elo (for the live DC+Elo blend baseline)
class Elo {
  elo = new Map<string, number>(); played = new Map<string, number>(); sDX = 0; sSq = 0; sT = 0; n = 0;
  g(t: string) { return this.elo.get(t) ?? 1500; }
  predict(r: Row): P | null {
    if (this.n < 300) return null;
    if ((this.played.get(r.home) ?? 0) < MIN_HISTORY || (this.played.get(r.away) ?? 0) < MIN_HISTORY) return null;
    const gpe = this.sDX / this.sSq, avg = this.sT / this.n, gap = this.g(r.home) - this.g(r.away) + (r.neutral ? 0 : 100), sup = gap * gpe, half = avg / 2;
    const g = scoreGrid(Math.max(0.15, half + sup / 2), Math.max(0.15, half - sup / 2), MAX_GOALS);
    return { H: g.pHome, D: g.pDraw, A: g.pAway };
  }
  update(r: Row) { const kf = r.tournament.toLowerCase() === 'friendly' ? 20 : 40, gap = this.g(r.home) - this.g(r.away) + (r.neutral ? 0 : 100), expH = 1 / (1 + Math.pow(10, -gap / 400)), resH = r.hs > r.as ? 1 : r.hs < r.as ? 0 : 0.5, m = Math.abs(r.hs - r.as) <= 1 ? 1 : Math.abs(r.hs - r.as) === 2 ? 1.5 : (11 + Math.abs(r.hs - r.as)) / 8, delta = kf * m * (resH - expH); this.elo.set(r.home, this.g(r.home) + delta); this.elo.set(r.away, this.g(r.away) - delta); this.played.set(r.home, (this.played.get(r.home) ?? 0) + 1); this.played.set(r.away, (this.played.get(r.away) ?? 0) + 1); this.sDX += gap * (r.hs - r.as); this.sSq += gap * gap; this.sT += r.hs + r.as; this.n++; }
}

const W = BOUNDS.length - 1;
const win = (d: string) => { for (let i = 0; i < W; i++) if (d >= BOUNDS[i] && d < BOUNDS[i + 1]) return i; return -1; };
interface Acc { s: number; n: number; }
const mk = (): Acc => ({ s: 0, n: 0 });
const ad = (a: Acc, p: P, o: O) => { a.s += rps(p, o); a.n++; };
const rp = (a: Acc) => (a.n ? a.s / a.n : NaN);

const dc = new DC(), sq = new Squad(), elo = new Elo();
const base = Array.from({ length: W }, mk);             // bare DC
const dcSquad = Array.from({ length: W }, mk);          // DC + squad(0.3)
const live = Array.from({ length: W }, mk);             // 0.6 DC + 0.4 Elo (shipped)
const liveSquad = WEIGHTS.map(() => Array.from({ length: W }, mk)); // live + squad
for (const r of rows) {
  const comp = r.tournament.toLowerCase() !== 'friendly';
  const w = win(r.date);
  if (comp && w >= 0) {
    const pd = dc.predict(r), ps = sq.predict(r), pe = elo.predict(r);
    if (pd && ps && pe) {
      const o = oc(r.hs, r.as);
      ad(base[w], pd, o);
      ad(dcSquad[w], { H: 0.7 * pd.H + 0.3 * ps.H, D: 0.7 * pd.D + 0.3 * ps.D, A: 0.7 * pd.A + 0.3 * ps.A }, o);
      const lb = { H: 0.6 * pd.H + 0.4 * pe.H, D: 0.6 * pd.D + 0.4 * pe.D, A: 0.6 * pd.A + 0.4 * pe.A };
      ad(live[w], lb, o);
      WEIGHTS.forEach((ws, k) => ad(liveSquad[k][w], { H: (1 - ws) * lb.H + ws * ps.H, D: (1 - ws) * lb.D + ws * ps.D, A: (1 - ws) * lb.A + ws * ps.A }, o));
    }
  }
  dc.update(r); sq.update(r); elo.update(r);
}

const f = (x: number) => x.toFixed(4);
const dd = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(4);
console.log('Rolling 2-year windows, FIFA-covered competitive matches. * = clean out-of-sample.\n');
console.log('(A) Does squad beat bare DC?');
console.log('window      n     DC        DC+squad.3  Δ');
for (let i = 0; i < W; i++) {
  const lbl = `${BOUNDS[i].slice(0, 4)}-${BOUNDS[i + 1].slice(2, 4)}${BOUNDS[i] >= '2020-01-01' ? '*' : ' '}`;
  console.log(`${lbl}  ${String(base[i].n).padStart(4)}  ${f(rp(base[i]))}   ${f(rp(dcSquad[i]))}  ${dd(rp(base[i]) - rp(dcSquad[i]))}`);
}
console.log('\n(B) Does squad ADD to the live DC+Elo blend (the real question)?');
console.log('window      n     live      +squad.3   Δ          +squad.4   Δ');
for (let i = 0; i < W; i++) {
  const lbl = `${BOUNDS[i].slice(0, 4)}-${BOUNDS[i + 1].slice(2, 4)}${BOUNDS[i] >= '2020-01-01' ? '*' : ' '}`;
  const lb = rp(live[i]);
  console.log(`${lbl}  ${String(live[i].n).padStart(4)}  ${f(lb)}   ${f(rp(liveSquad[0][i]))}  ${dd(lb - rp(liveSquad[0][i]))}   ${f(rp(liveSquad[1][i]))}  ${dd(lb - rp(liveSquad[1][i]))}`);
}
console.log('\n(positive Δ = squad helped that window.)');
