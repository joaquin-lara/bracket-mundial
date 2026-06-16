/**
 * Rolling-window robustness check. The main experiments all scored on a single
 * 2018+ test window; with many ideas tried, a small "win" could be luck specific
 * to that era. Here we replay history once (online, predict-before-update) and
 * score each idea on SIX separate 2-year windows, using FIXED settings chosen
 * earlier (blend weight 0.4, altitude coef 0.15, tuned DC) -- no re-tuning per
 * window. If a win holds across eras it is real; if it only shows up once it is
 * noise. Windows 2018+ are the clean out-of-sample ones (the tuning used
 * 2013-2018, so 2014-18 windows overlap it -- flagged below).
 *
 *   tsx scripts/rolling-validation.ts
 */
import { readFileSync } from 'fs';
import path from 'path';
import { scoreGrid } from '../src/lib/ml/poisson';

const CSV = path.join(process.cwd(), 'data', 'results.csv');
const MAX_GOALS = 8, MIN_HISTORY = 5, HOME_ADV = 100;
const BLEND_W = 0.4, ALT_COEF = 0.15;
const BOUNDS = ['2014-01-01', '2016-01-01', '2018-01-01', '2020-01-01', '2022-01-01', '2024-01-01', '2026-01-01'];

interface Row { date: string; home: string; away: string; hs: number; as: number; tournament: string; neutral: boolean; city: string; }
function parse(text: string): Row[] {
  const out: Row[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    if (c.length < 9) continue;
    const hs = Number(c[3]), as = Number(c[4]);
    if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
    out.push({ date: c[0], home: c[1], away: c[2], hs, as, tournament: c[5], city: c[6], neutral: c[8].trim().toUpperCase() === 'TRUE' });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}
function norm(s: string): string { return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
const ALT_M: Record<string, number> = {
  lapaz: 3640, elalto: 4150, oruro: 3706, sucre: 2810, cochabamba: 2558, quito: 2850, cusco: 3399,
  bogota: 2640, tunja: 2820, mexicocity: 2240, toluca: 2660, pachuca: 2400, puebla: 2135,
  addisababa: 2355, johannesburg: 1753, pretoria: 1339, nairobi: 1795, sanaa: 2250, tehran: 1200,
};
function altKm(city: string): number { const m = ALT_M[norm(city)]; return m && m >= 1000 ? m / 1000 : 0; }

type O = 'H' | 'D' | 'A';
const oc = (h: number, a: number): O => (h > a ? 'H' : h < a ? 'A' : 'D');
interface P { H: number; D: number; A: number; }
function kf(t: string): number {
  const x = t.toLowerCase();
  if (x === 'fifa world cup') return 60;
  if (x.includes('world cup')) return 40;
  if (x.includes('confederations')) return 50;
  if (x.includes('uefa euro') || x.includes('copa américa') || x.includes('copa america') || x.includes('african cup of nations') || x.includes('afc asian cup') || x.includes('gold cup') || x.includes('nations league')) return x.includes('qualification') ? 40 : 50;
  if (x === 'friendly') return 20;
  return 30;
}
const mm = (d: number) => { const m = Math.abs(d); return m <= 1 ? 1 : m === 2 ? 1.5 : (11 + m) / 8; };

interface Cfg { shrink: number; friendlyWeight: number; altCoef: number; }
class DC {
  att = new Map<string, number>(); def = new Map<string, number>(); played = new Map<string, number>();
  base = Math.log(1.35); home = 0.25; rho = -0.07; lrTeam = 0.05; lrGlobal = 0.004;
  constructor(private cfg: Cfg) {}
  private a(t: string) { return this.att.get(t) ?? 0; }
  private d(t: string) { return this.def.get(t) ?? 0; }
  private means(r: Row): [number, number] {
    let ha = r.neutral ? 0 : this.home;
    if (!r.neutral) ha += this.cfg.altCoef * altKm(r.city);
    return [Math.exp(this.base + ha + this.a(r.home) - this.d(r.away)), Math.exp(this.base + this.a(r.away) - this.d(r.home))];
  }
  predict(r: Row): P | null {
    if ((this.played.get(r.home) ?? 0) < MIN_HISTORY || (this.played.get(r.away) ?? 0) < MIN_HISTORY) return null;
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
  update(r: Row): void {
    const [lh, la] = this.means(r);
    const w = r.tournament.toLowerCase() === 'friendly' ? this.cfg.friendlyWeight : 1;
    const eh = r.hs - lh, ea = r.as - la, lr = this.lrTeam * w, s = this.cfg.shrink;
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
// online Elo: goalsPerElo computed from accumulated past stats (no leakage)
class Elo {
  elo = new Map<string, number>(); played = new Map<string, number>();
  sDX = 0; sSq = 0; sTot = 0; n = 0;
  private g(t: string) { return this.elo.get(t) ?? 1500; }
  predict(r: Row): P | null {
    if (this.n < 500) return null;
    if ((this.played.get(r.home) ?? 0) < MIN_HISTORY || (this.played.get(r.away) ?? 0) < MIN_HISTORY) return null;
    const gpe = this.sDX / this.sSq, avg = this.sTot / this.n;
    const gap = this.g(r.home) - this.g(r.away) + (r.neutral ? 0 : HOME_ADV);
    const sup = gap * gpe, half = avg / 2;
    const g = scoreGrid(Math.max(0.15, half + sup / 2), Math.max(0.15, half - sup / 2), MAX_GOALS);
    return { H: g.pHome, D: g.pDraw, A: g.pAway };
  }
  update(r: Row): void {
    const gap = this.g(r.home) - this.g(r.away) + (r.neutral ? 0 : HOME_ADV);
    const expH = 1 / (1 + Math.pow(10, -gap / 400));
    const resH = r.hs > r.as ? 1 : r.hs < r.as ? 0 : 0.5;
    const delta = kf(r.tournament) * mm(r.hs - r.as) * (resH - expH);
    this.elo.set(r.home, this.g(r.home) + delta);
    this.elo.set(r.away, this.g(r.away) - delta);
    this.played.set(r.home, (this.played.get(r.home) ?? 0) + 1);
    this.played.set(r.away, (this.played.get(r.away) ?? 0) + 1);
    this.sDX += gap * (r.hs - r.as); this.sSq += gap * gap; this.sTot += r.hs + r.as; this.n++;
  }
}
const rpsOf = (p: P, o: O) => { const c1 = p.H, c2 = p.H + p.D, e1 = o === 'H' ? 1 : 0, e2 = o === 'A' ? 0 : 1; return 0.5 * ((c1 - e1) ** 2 + (c2 - e2) ** 2); };
interface Acc { s: number; n: number; }
const acc = (): Acc => ({ s: 0, n: 0 });
const addr = (a: Acc, p: P, o: O) => { a.s += rpsOf(p, o); a.n++; };
const rp = (a: Acc) => (a.n ? a.s / a.n : NaN);

const rows = parse(readFileSync(CSV, 'utf8'));
const W = BOUNDS.length - 1;
const win = (d: string) => { for (let i = 0; i < W; i++) if (d >= BOUNDS[i] && d < BOUNDS[i + 1]) return i; return -1; };

const dcBase = new DC({ shrink: 0.0015, friendlyWeight: 0.5, altCoef: 0 });
const dcTuned = new DC({ shrink: 0.0005, friendlyWeight: 0.7, altCoef: 0 });
const dcAlt = new DC({ shrink: 0.0015, friendlyWeight: 0.5, altCoef: ALT_COEF });
const elo = new Elo();

const base = Array.from({ length: W }, acc), tuned = Array.from({ length: W }, acc);
const blend = Array.from({ length: W }, acc), baseForBlend = Array.from({ length: W }, acc);
const altBase = Array.from({ length: W }, acc), altAdj = Array.from({ length: W }, acc);

for (const r of rows) {
  const comp = r.tournament.toLowerCase() !== 'friendly';
  const w = win(r.date);
  if (comp && w >= 0) {
    const o = oc(r.hs, r.as);
    const pB = dcBase.predict(r), pT = dcTuned.predict(r), pA = dcAlt.predict(r), pE = elo.predict(r);
    if (pB) addr(base[w], pB, o);
    if (pT) addr(tuned[w], pT, o);
    if (pB && pE) {
      addr(baseForBlend[w], pB, o);
      addr(blend[w], { H: BLEND_W * pE.H + (1 - BLEND_W) * pB.H, D: BLEND_W * pE.D + (1 - BLEND_W) * pB.D, A: BLEND_W * pE.A + (1 - BLEND_W) * pB.A }, o);
    }
    if (altKm(r.city) > 0 && !r.neutral && pB && pA) { addr(altBase[w], pB, o); addr(altAdj[w], pA, o); }
  }
  dcBase.update(r); dcTuned.update(r); dcAlt.update(r); elo.update(r);
}

const f = (x: number) => x.toFixed(4);
const d4 = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(4);
console.log('Rolling 2-year windows. RPS (lower better). Δ = improvement vs DC. * = clean out-of-sample (post-2018 tuning).\n');
console.log('window        n   DC       blend(.4)  Δ        tunedDC   Δ        | alt n   DC->alt     Δ');
for (let i = 0; i < W; i++) {
  const label = `${BOUNDS[i].slice(0, 4)}-${BOUNDS[i + 1].slice(2, 4)}${BOUNDS[i] >= '2018-01-01' ? '*' : ' '}`;
  const bRPS = rp(baseForBlend[i]), blRPS = rp(blend[i]);
  const tRPS = rp(tuned[i]), tBase = rp(base[i]);
  const aB = rp(altBase[i]), aA = rp(altAdj[i]);
  const altStr = altBase[i].n ? `| ${String(altBase[i].n).padStart(3)}   ${f(aB)}->${f(aA)} ${d4(aB - aA)}` : '|  (no altitude games)';
  console.log(`${label}  ${String(base[i].n).padStart(4)}  ${f(tBase)}   ${f(blRPS)}   ${d4(bRPS - blRPS)}   ${f(tRPS)}  ${d4(tBase - tRPS)}  ${altStr}`);
}
console.log('\n(blend/tuned Δ are vs DC on the same matches; positive Δ = the idea helped that window.)');
