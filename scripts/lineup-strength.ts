/**
 * Actual-lineup strength from scraped fbref starting XIs joined to FIFA ratings.
 *
 * The squad "talent pool" feature (scripts/squad-strength.ts) is a SLOW, season
 * level signal -- and the backtest showed it adds nothing on top of Dixon-Coles,
 * because results already encode squad quality. Actual lineups are different:
 * they say WHO is on the pitch tonight (injuries, suspensions, rotation, B-teams)
 * -- information results-based ratings cannot have until after the fact.
 *
 * For each scraped match we take a team's starting XI, look up each starter's
 * FIFA `overall` (using the edition in effect on the match date, falling back to
 * a neighbouring edition when a nation is missing), average the ones we can rate,
 * and compare that to the nation's *strongest* XI in that edition (mean of the
 * top 11 overalls). The gap is the feature:
 *
 *   delta = mean(actual starting XI overall) - mean(nation's best 11 overall)
 *
 * delta ~ 0  -> they fielded their A-team;  delta < 0 -> a weakened side.
 * This is exactly the "is a key player missing?" signal, and -- because the
 * lineups are historical -- it is backtestable (scripts/backtest.ts).
 *
 * Reads:
 *   lineups/fbref_lineups.json   (scraped XIs, committed)
 *   data/fifa/male_players_<yy>.csv  (FIFA ratings, gitignored, re-fetched)
 *
 *   tsx scripts/lineup-strength.ts   # self-test: coverage + sample deltas
 */
import { readFileSync, existsSync } from 'fs';
import path from 'path';

const ROOT = process.cwd();
const FIFA_DIR = path.join(ROOT, 'data', 'fifa');
const LINEUPS_PATH = path.join(ROOT, 'lineups', 'fbref_lineups.json');
const EDITIONS = [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25];
const MIN_MATCHED = 7; // need at least this many rated starters to trust an XI
const BEST_XI = 11;

// --- text helpers -----------------------------------------------------------
function norm(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .trim();
}
function tokens(s: string): string[] {
  return norm(s).split(/\s+/).filter(Boolean);
}

// Map the many spellings of a nation (fbref team, FIFA nationality_name, and the
// results dataset) onto one key so all three sides join.
const NAT_ALIASES: Record<string, string> = {
  korearepublic: 'southkorea',
  koreadpr: 'northkorea',
  capeverdeislands: 'capeverde',
  caboverde: 'capeverde',
  congodr: 'drcongo',
  chinapr: 'china',
  iranislamicrepublic: 'iran',
  iriran: 'iran',
  usa: 'unitedstates',
  turkiye: 'turkey',
  czechia: 'czechrepublic',
  ivorycoast: 'cotedivoire',
  bosniaandherzegovina: 'bosniaherzegovina',
  dominicanrep: 'dominicanrepublic',
  equguinea: 'equatorialguinea',
  trintobago: 'trinidadandtobago',
  northmacedonia: 'macedonia',
};
function keyNat(s: string): string {
  const n = norm(s).replace(/\s+/g, '');
  return NAT_ALIASES[n] ?? n;
}

// minimal quote-aware CSV splitter (player names embed commas)
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

// --- FIFA editions: per-nation player index + best-XI baseline --------------
interface Player {
  toks: Set<string>;
  ov: number;
}
interface Edition {
  yy: number;
  start: string;
  byNat: Map<string, Player[]>;
  topOv: Map<string, number[]>; // overalls sorted desc, for the best-XI baseline
}

function buildEdition(yy: number): Edition {
  const file = path.join(FIFA_DIR, `male_players_${yy}.csv`);
  const text = readFileSync(file, 'utf8');
  const nl = text.indexOf('\n');
  const header = splitCsvLine(text.slice(0, nl).replace(/\r$/, ''));
  const iOv = header.indexOf('overall');
  const iNat = header.indexOf('nationality_name');
  const iShort = header.indexOf('short_name');
  const iLong = header.indexOf('long_name');
  if (iOv < 0 || iNat < 0) throw new Error(`bad header in ${file}`);

  const byNat = new Map<string, Player[]>();
  const topOv = new Map<string, number[]>();
  let start = nl + 1;
  while (start < text.length) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = text.length;
    const line = text.slice(start, end).replace(/\r$/, '');
    start = end + 1;
    if (!line) continue;
    const c = splitCsvLine(line);
    const ov = Number(c[iOv]);
    const nat = c[iNat];
    if (!Number.isFinite(ov) || !nat) continue;
    const key = keyNat(nat);
    const toks = new Set<string>();
    if (iShort >= 0) tokens(c[iShort]).forEach((t) => toks.add(t));
    if (iLong >= 0) tokens(c[iLong]).forEach((t) => toks.add(t));
    if (!byNat.has(key)) byNat.set(key, []);
    byNat.get(key)!.push({ toks, ov });
    if (!topOv.has(key)) topOv.set(key, []);
    topOv.get(key)!.push(ov);
  }
  for (const list of topOv.values()) list.sort((a, b) => b - a);
  return { yy, start: `${2000 + yy - 1}-09-01`, byNat, topOv };
}

let EDS: Edition[] | null = null;
function editions(): Edition[] {
  if (EDS) return EDS;
  EDS = EDITIONS.filter((yy) => existsSync(path.join(FIFA_DIR, `male_players_${yy}.csv`)))
    .map(buildEdition)
    .sort((a, b) => a.start.localeCompare(b.start));
  return EDS;
}

/** Editions to consult for a date: the in-effect one first, then the rest most
 *  recent first, so a nation missing from one edition falls back to another. */
function editionOrder(date: string): Edition[] {
  const eds = editions();
  let prim = eds[0];
  for (const e of eds) if (e.start <= date) prim = e;
  return [prim, ...eds.filter((e) => e !== prim).reverse()];
}

function findOverall(name: string, natKey: string, order: Edition[]): number | null {
  const nt = tokens(name);
  if (!nt.length) return null;
  const nset = new Set(nt);
  for (const ed of order) {
    const pool = ed.byNat.get(natKey);
    if (!pool) continue;
    // 1) every token of the fbref name appears in the player's token set
    for (const p of pool) if ([...nset].every((t) => p.toks.has(t))) return p.ov;
    // 2) surname + first initial
    if (nt.length >= 2) {
      const last = nt[nt.length - 1];
      const fi = nt[0][0];
      const c = pool.filter((p) => p.toks.has(last) && [...p.toks].some((t) => t[0] === fi));
      if (c.length) return c[0].ov;
    }
    // 3) unique surname
    const last = nt[nt.length - 1];
    const c = pool.filter((p) => p.toks.has(last));
    if (c.length === 1) return c[0].ov;
  }
  return null;
}

function bestXi(natKey: string, order: Edition[]): number | null {
  for (const ed of order) {
    const ovs = ed.topOv.get(natKey);
    if (ovs && ovs.length >= BEST_XI) {
      const top = ovs.slice(0, BEST_XI);
      return top.reduce((s, x) => s + x, 0) / top.length;
    }
  }
  return null;
}

// --- lineup deltas, keyed by (date | nation) --------------------------------
interface Starter {
  name: string;
}
interface Lineup {
  team: string;
  starters: Starter[];
}
interface Match {
  date: string | null;
  lineups: Lineup[];
}

export interface TeamLineup {
  delta: number; // actual XI mean overall - nation best-XI mean overall
  matched: number; // rated starters used
  size: number; // starters listed
}

let DELTAS: Map<string, TeamLineup> | null = null;

function dkey(date: string, team: string): string {
  return `${date}|${keyNat(team)}`;
}

/** Compute one team's lineup delta in one match, or null if too few rated. */
function teamDelta(team: string, starters: Starter[], date: string): TeamLineup | null {
  const order = editionOrder(date);
  const natKey = keyNat(team);
  const ovs: number[] = [];
  for (const s of starters) {
    const ov = findOverall(s.name, natKey, order);
    if (ov != null) ovs.push(ov);
  }
  if (ovs.length < MIN_MATCHED) return null;
  const base = bestXi(natKey, order);
  if (base == null) return null;
  const actual = ovs.reduce((a, b) => a + b, 0) / ovs.length;
  return { delta: actual - base, matched: ovs.length, size: starters.length };
}

function load(): Map<string, TeamLineup> {
  if (DELTAS) return DELTAS;
  DELTAS = new Map();
  if (!existsSync(LINEUPS_PATH) || editions().length === 0) return DELTAS;
  const raw = JSON.parse(readFileSync(LINEUPS_PATH, 'utf8')) as Record<string, Match>;
  for (const m of Object.values(raw)) {
    if (!m.date) continue;
    for (const lu of m.lineups || []) {
      if (!lu.team || !lu.starters?.length) continue;
      const d = teamDelta(lu.team, lu.starters, m.date);
      if (d) DELTAS.set(dkey(m.date, lu.team), d);
    }
  }
  return DELTAS;
}

export function lineupsAvailable(): boolean {
  return existsSync(LINEUPS_PATH) && editions().length > 0;
}

/** A team's lineup-strength delta for a given match date, or null if unknown. */
export function lineupDeltaFor(team: string, date: string): number | null {
  const d = load().get(dkey(date, team));
  return d ? d.delta : null;
}

// --- self-test --------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('lineup-strength.ts')) {
  if (!lineupsAvailable()) {
    console.error('Missing lineups/fbref_lineups.json or data/fifa CSVs.');
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(LINEUPS_PATH, 'utf8')) as Record<string, Match>;
  const matches = Object.values(raw);
  let teams = 0;
  let withDelta = 0;
  let bothDelta = 0;
  const samples: { label: string; d: number }[] = [];
  for (const m of matches) {
    if (!m.date) continue;
    const ds: (number | null)[] = [];
    for (const lu of m.lineups || []) {
      teams++;
      const d = lineupDeltaFor(lu.team, m.date);
      ds.push(d);
      if (d != null) withDelta++;
      if (d != null && samples.length < 8) samples.push({ label: `${lu.team} ${m.date}`, d });
    }
    if (ds.length === 2 && ds[0] != null && ds[1] != null) bothDelta++;
  }
  console.log(`Editions loaded: ${editions().map((e) => e.yy).join(', ')}`);
  console.log(`Matches: ${matches.length}`);
  console.log(`Team-lineups with a usable delta: ${withDelta}/${teams} (${((100 * withDelta) / teams).toFixed(1)}%)`);
  console.log(`Matches where BOTH teams have a delta: ${bothDelta}/${matches.length}`);
  console.log('\nSample deltas (actual XI vs best XI, negative = weakened side):');
  for (const s of samples) console.log(`  ${s.label.padEnd(28)} ${s.d >= 0 ? '+' : ''}${s.d.toFixed(2)}`);
}
