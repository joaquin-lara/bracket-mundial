/**
 * Pre-compute head-to-head history between the 48 World Cup teams from the full
 * results dataset, so the app can show it without shipping all 49k matches.
 * Reads data/results.csv, writes public/h2h.json (served statically, fetched on
 * demand by the matchup view).
 *
 *   tsx scripts/build-h2h.ts   (needs data/results.csv -- run build:elo first)
 */
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { lookup, TEAMS } from '../src/lib/ml/teams';

const ROOT = process.cwd();
const CSV = path.join(ROOT, 'data', 'results.csv');
const OUT = path.join(ROOT, 'public', 'h2h.json');
const RECENT = 12; // recent meetings kept per pair for display

interface Meeting { date: string; h: string; a: string; hs: number; as: number; t: string }
interface Pair {
  a: string; b: string; // team codes, a < b
  played: number; winsA: number; winsB: number; draws: number; gfA: number; gfB: number;
  recent: Meeting[];
}

function main() {
  const text = readFileSync(CSV, 'utf8');
  const lines = text.split(/\r?\n/);
  const pairs = new Map<string, Pair>();

  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    if (c.length < 9) continue;
    const hs = Number(c[3]); const as = Number(c[4]);
    if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
    const h = lookup(c[1]); const a = lookup(c[2]);
    if (!h || !a || h.code === a.code) continue; // both must be WC-2026 teams

    const [x, y] = [h.code, a.code].sort();
    const key = `${x}|${y}`;
    let p = pairs.get(key);
    if (!p) { p = { a: x, b: y, played: 0, winsA: 0, winsB: 0, draws: 0, gfA: 0, gfB: 0, recent: [] }; pairs.set(key, p); }

    // goals for x / y regardless of who was home
    const xGoals = h.code === x ? hs : as;
    const yGoals = h.code === x ? as : hs;
    p.played++; p.gfA += xGoals; p.gfB += yGoals;
    if (xGoals > yGoals) p.winsA++; else if (xGoals < yGoals) p.winsB++; else p.draws++;
    p.recent.push({ date: c[0], h: h.code, a: a.code, hs, as, t: c[5] });
  }

  for (const p of pairs.values()) {
    p.recent.sort((m, n) => n.date.localeCompare(m.date));
    p.recent = p.recent.slice(0, RECENT);
  }

  const out: Record<string, Pair> = {};
  for (const [k, v] of pairs) out[k] = v;
  writeFileSync(OUT, JSON.stringify(out));
  console.log(`Wrote ${OUT}: ${pairs.size} pairs (of ${(TEAMS.length * (TEAMS.length - 1)) / 2} possible), ${(JSON.stringify(out).length / 1024).toFixed(0)} KB`);
}

main();
