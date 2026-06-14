/**
 * National "talent pool" strength from the sofifa player ratings
 * (eddwebster/football_analytics mirror of the FIFA 15-22 datasets).
 *
 * For each FIFA edition we take a country's best 23 players by overall rating
 * and average them -- a snapshot of how strong the available player pool was
 * that year. Because we have eight editions (2014-2021) this is a *historical*
 * feature: for any match we can ask how strong each side's pool was at the time,
 * which is what makes it backtestable rather than a present-day-only prior.
 *
 * Player ratings are a cleaner strength signal than transfer values (no age/hype
 * inflation) and, unlike the results-based Elo, they move the moment a golden
 * generation arrives or fades -- the "players join and leave" effect, at squad
 * level. Who actually starts a given match (injuries/rotation) is a separate,
 * live concern handled elsewhere.
 *
 * Reads data/fifa/male_players_<yy>.csv (downloaded out of band, gitignored).
 *   tsx scripts/squad-strength.ts   # self-test: print sample strengths
 */
import { readFileSync, existsSync } from 'fs';
import path from 'path';

const FIFA_DIR = path.join(process.cwd(), 'data', 'fifa');
// All editions we know how to consume. The FIFA->EA Sports FC rename keeps the
// sofifa schema, so FC 24/25 slot in as 24/25. We only load the ones whose CSV
// is actually on disk, so newer editions extend coverage with zero code change
// -- just drop male_players_<yy>.csv into data/fifa/.
const EDITIONS = [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25];
const MIN_EDITIONS = 4; // enough snapshots for the feature to be meaningful
const SQUAD_SIZE = 23; // best N players define the pool
const MIN_PLAYERS = 11; // ignore nations with too few rated players

/** FIFA edition YY ships in Sept of year YY-1; that is when it takes effect. */
function editionStart(yy: number): string {
  return `${2000 + yy - 1}-09-01`;
}

// strip accents/case/punctuation so spellings can be matched
function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// sofifa spelling (normalized) -> results-dataset spelling (normalized)
const ALIASES: Record<string, string> = {
  korearepublic: 'southkorea',
  koreadpr: 'northkorea',
  capeverdeislands: 'capeverde',
  congodr: 'drcongo',
  chinapr: 'china',
  unitedstates: 'unitedstates',
  republicofireland: 'republicofireland',
};

function canonical(nationalityName: string): string {
  const n = norm(nationalityName);
  return ALIASES[n] ?? n;
}

// minimal quote-aware CSV line splitter (player_positions etc. embed commas)
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

function buildEdition(yy: number): Map<string, number> {
  const file = path.join(FIFA_DIR, `male_players_${yy}.csv`);
  const text = readFileSync(file, 'utf8');
  const nl = text.indexOf('\n');
  const header = splitCsvLine(text.slice(0, nl).replace(/\r$/, ''));
  const iOverall = header.indexOf('overall');
  const iNat = header.indexOf('nationality_name');
  if (iOverall < 0 || iNat < 0) throw new Error(`bad header in ${file}`);

  const byNation = new Map<string, number[]>();
  let start = nl + 1;
  while (start < text.length) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = text.length;
    const line = text.slice(start, end).replace(/\r$/, '');
    start = end + 1;
    if (!line) continue;
    const c = splitCsvLine(line);
    const ov = Number(c[iOverall]);
    const nat = c[iNat];
    if (!Number.isFinite(ov) || !nat) continue;
    const key = canonical(nat);
    if (!byNation.has(key)) byNation.set(key, []);
    byNation.get(key)!.push(ov);
  }

  const strength = new Map<string, number>();
  for (const [key, list] of byNation) {
    if (list.length < MIN_PLAYERS) continue;
    list.sort((a, b) => b - a);
    const top = list.slice(0, SQUAD_SIZE);
    strength.set(key, top.reduce((s, x) => s + x, 0) / top.length);
  }
  return strength;
}

let LOADED: { editions: { yy: number; start: string; strength: Map<string, number> }[] } | null = null;

function presentEditions(): number[] {
  return EDITIONS.filter((yy) => existsSync(path.join(FIFA_DIR, `male_players_${yy}.csv`)));
}

export function squadDataAvailable(): boolean {
  return presentEditions().length >= MIN_EDITIONS;
}

function load() {
  if (LOADED) return LOADED;
  const editions = presentEditions()
    .map((yy) => ({ yy, start: editionStart(yy), strength: buildEdition(yy) }))
    .sort((a, b) => a.start.localeCompare(b.start));
  LOADED = { editions };
  return LOADED;
}

/**
 * Talent-pool strength (mean overall of the best 23) for `team` as known at
 * `date`, using the most recent FIFA edition on or before that date. Returns
 * null when there is no edition yet or the nation isn't rated.
 */
export function strengthAsOf(team: string, date: string): number | null {
  const { editions } = load();
  const key = canonical(team);
  let chosen: Map<string, number> | null = null;
  for (const e of editions) {
    if (e.start <= date) chosen = e.strength;
    else break;
  }
  if (!chosen) return null;
  return chosen.get(key) ?? null;
}

// --- self-test --------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('squad-strength.ts')) {
  if (!squadDataAvailable()) {
    console.error('FIFA CSVs missing under data/fifa/. Download them first.');
    process.exit(1);
  }
  const { editions } = load();
  console.log('Editions loaded:', editions.map((e) => `${e.yy}(${e.strength.size} nations)`).join(', '));
  const teams = ['Brazil', 'France', 'Argentina', 'South Korea', 'United States', 'Cape Verde', 'DR Congo', 'Curaçao'];
  const dates = ['2015-06-01', '2019-06-01', '2022-06-01', '2026-06-01'];
  console.log('\nTalent-pool strength (mean overall of best 23):');
  console.log('team'.padEnd(16) + dates.map((d) => d.slice(0, 7).padStart(9)).join(''));
  for (const t of teams) {
    const row = dates.map((d) => {
      const s = strengthAsOf(t, d);
      return (s == null ? '-' : s.toFixed(1)).padStart(9);
    });
    console.log(t.padEnd(16) + row.join(''));
  }
}
