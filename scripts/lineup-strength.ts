/**
 * Join actual starting lineups (StatsBomb) to FIFA / EA FC player ratings, and
 * turn an XI into a strength number.
 *
 * THE SIGNAL we are testing: who is *literally on the pitch tonight* carries
 * information Dixon-Coles cannot have (injuries, suspensions, rotation). For a
 * given match we compute, per team:
 *   - actualXI  = mean `overall` of the matched starters (scaled by whoever we
 *                 could match, so a few holes degrade gracefully)
 *   - fullXI    = mean `overall` of that nation's 11 highest-rated players in the
 *                 FIFA edition in force on the match date (the "full strength"
 *                 they COULD field)
 *   - delta     = actualXI - fullXI  (<= 0; how depleted tonight's XI is)
 * `delta` is the orthogonal feature: a team fielding a weakened XI relative to
 * its own ceiling is the thing DC, which only sees results, can't anticipate.
 *
 * THE JOIN (no shared key between StatsBomb and sofifa): match on normalized
 * name within the team's nationality. StatsBomb gives a player's full legal name
 * AND a common nickname; sofifa gives `long_name` (full) and `short_name`
 * ("L. Messi"). We index each FIFA player under several name keys and try
 * several candidate keys per lineup player, so full names, reordered/extra
 * middle names, nicknames, and "initial + surname" all have a chance to hit.
 * No DOB: StatsBomb lineups don't carry it, so nationality is the only
 * disambiguator -- strong here because nationality == the national team.
 *
 *   tsx scripts/lineup-strength.ts   # self-test: match rates + unmatched stars
 */
import { readFileSync, existsSync } from 'fs';
import path from 'path';

const FIFA_DIR = path.join(process.cwd(), 'data', 'fifa');
const EDITIONS = [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25];
const FULL_XI_N = 11; // "full strength" reference = top 11 by overall

/** FIFA edition YY ships in Sept of year YY-1; that is when it takes effect. */
function editionStart(yy: number): string {
  return `${2000 + yy - 1}-09-01`;
}

// --- text normalization -----------------------------------------------------
// Letters that are NOT combining-accent decompositions (so NFD leaves them
// intact) but must be transliterated, or our tokenizer splits names mid-word
// (e.g. "Højbjerg" -> "h","jbjerg"). Covers Nordic/Turkish/Slavic specials.
const SPECIAL: Record<string, string> = {
  ø: 'o', æ: 'ae', œ: 'oe', ß: 'ss', ð: 'd', þ: 'th', ł: 'l', đ: 'd',
  ı: 'i', ŀ: 'l', ħ: 'h', ŧ: 't',
};
function deaccent(s: string): string {
  let out = '';
  for (const ch of s.toLowerCase()) out += SPECIAL[ch] ?? ch;
  return out.normalize('NFD').replace(/[̀-ͯ]/g, '');
}
/** lowercase, strip accents, split into alphanumeric tokens. */
function toks(s: string): string[] {
  return deaccent(s)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}
const joinKey = (t: string[]) => t.join('');
const sortKey = (t: string[]) => [...t].sort().join('');

// nationality canonicalization (sofifa spelling <-> StatsBomb spelling)
function natNorm(s: string): string {
  return joinKey(toks(s));
}
const NAT_ALIASES: Record<string, string> = {
  korearepublic: 'southkorea',
  koreadpr: 'northkorea',
  capeverdeislands: 'capeverde',
  congodr: 'drcongo',
  drcongo: 'drcongo',
  chinapr: 'china',
  ireland: 'republicofireland',
  iranislamicrepublic: 'iran',
  turkiye: 'turkey',
};
function canonNat(s: string): string {
  const n = natNorm(s);
  return NAT_ALIASES[n] ?? n;
}

// minimal quote-aware CSV splitter (sofifa embeds commas in quoted fields)
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

// --- FIFA edition index -----------------------------------------------------
interface Edition {
  yy: number;
  start: string;
  // nationality -> (name key -> best overall)
  byNat: Map<string, Map<string, number>>;
  // nationality -> top-N overall average (full-strength reference)
  fullXi: Map<string, number>;
}

function addKey(m: Map<string, number>, key: string, ov: number): void {
  if (!key) return;
  const prev = m.get(key);
  if (prev === undefined || ov > prev) m.set(key, ov);
}

function buildEdition(yy: number): Edition {
  const text = readFileSync(path.join(FIFA_DIR, `male_players_${yy}.csv`), 'utf8');
  const nl = text.indexOf('\n');
  const header = splitCsvLine(text.slice(0, nl).replace(/\r$/, ''));
  const iShort = header.indexOf('short_name');
  const iLong = header.indexOf('long_name'); // absent in the renamed FC25 file
  const iOverall = header.indexOf('overall');
  const iNat = header.indexOf('nationality_name');
  if (iShort < 0 || iOverall < 0 || iNat < 0) throw new Error(`bad header in edition ${yy}`);

  const byNat = new Map<string, Map<string, number>>();
  const overallsByNat = new Map<string, number[]>();
  let pos = nl + 1;
  while (pos < text.length) {
    let end = text.indexOf('\n', pos);
    if (end < 0) end = text.length;
    const line = text.slice(pos, end).replace(/\r$/, '');
    pos = end + 1;
    if (!line) continue;
    const c = splitCsvLine(line);
    const ov = Number(c[iOverall]);
    const natRaw = c[iNat];
    if (!Number.isFinite(ov) || !natRaw) continue;
    const nat = canonNat(natRaw);
    if (!byNat.has(nat)) {
      byNat.set(nat, new Map());
      overallsByNat.set(nat, []);
    }
    const m = byNat.get(nat)!;
    overallsByNat.get(nat)!.push(ov);
    // index this player under several name keys
    const short = c[iShort] ?? '';
    const long = iLong >= 0 ? c[iLong] ?? '' : '';
    for (const nm of [short, long]) {
      if (!nm) continue;
      const t = toks(nm);
      addKey(m, joinKey(t), ov);
      addKey(m, sortKey(t), ov);
    }
  }

  const fullXi = new Map<string, number>();
  for (const [nat, list] of overallsByNat) {
    if (list.length < FULL_XI_N) continue;
    list.sort((a, b) => b - a);
    const top = list.slice(0, FULL_XI_N);
    fullXi.set(nat, top.reduce((s, x) => s + x, 0) / top.length);
  }
  return { yy, start: editionStart(yy), byNat, fullXi };
}

let EDS: Edition[] | null = null;
function presentEditions(): number[] {
  return EDITIONS.filter((yy) => existsSync(path.join(FIFA_DIR, `male_players_${yy}.csv`)));
}
export function lineupDataAvailable(): boolean {
  return presentEditions().length >= 4;
}
function editions(): Edition[] {
  if (EDS) return EDS;
  EDS = presentEditions()
    .map(buildEdition)
    .sort((a, b) => a.start.localeCompare(b.start));
  return EDS;
}
function editionAsOf(date: string): Edition | null {
  let chosen: Edition | null = null;
  for (const e of editions()) {
    if (e.start <= date) chosen = e;
    else break;
  }
  return chosen;
}

// --- player -> overall lookup -----------------------------------------------
/** Candidate name keys for a lineup player, most-specific first. */
function candidateKeys(name: string, nick: string | null): string[] {
  const keys: string[] = [];
  const push = (k: string) => {
    if (k && !keys.includes(k)) keys.push(k);
  };
  for (const nm of [name, nick]) {
    if (!nm) continue;
    const t = toks(nm);
    if (!t.length) continue;
    push(joinKey(t)); // full, in order
    push(sortKey(t)); // full, order-independent
    // bridges to sofifa short_name ("L. Messi", "E. N'Dicka", "M. de Roon").
    const initial = t[0][0];
    push(initial + joinKey(t.slice(1))); // initial + WHOLE surname (compound ok)
    for (let i = 1; i < t.length; i++) push(initial + t[i]); // initial + each token
  }
  return keys;
}

export interface PlayerLite {
  name: string;
  nick: string | null;
}

export function playerOverall(team: string, date: string, p: PlayerLite): number | null {
  const ed = editionAsOf(date);
  if (!ed) return null;
  const m = ed.byNat.get(canonNat(team));
  if (!m) return null;
  for (const k of candidateKeys(p.name, p.nick)) {
    const ov = m.get(k);
    if (ov !== undefined) return ov;
  }
  return null;
}

export interface XiStrength {
  actualXI: number | null; // mean overall of matched starters
  fullXI: number | null; // top-11 reference for the nation/edition
  delta: number | null; // actualXI - fullXI (depletion; <= 0 typically)
  matched: number;
  total: number;
  missed: PlayerLite[]; // starters we could not match
}

export function xiStrength(team: string, date: string, xi: PlayerLite[]): XiStrength {
  const ed = editionAsOf(date);
  const overalls: number[] = [];
  const missed: PlayerLite[] = [];
  for (const p of xi) {
    const ov = playerOverall(team, date, p);
    if (ov == null) missed.push(p);
    else overalls.push(ov);
  }
  const actualXI = overalls.length ? overalls.reduce((s, x) => s + x, 0) / overalls.length : null;
  const fullXI = ed ? ed.fullXi.get(canonNat(team)) ?? null : null;
  const delta = actualXI != null && fullXI != null ? actualXI - fullXI : null;
  return { actualXI, fullXI, delta, matched: overalls.length, total: xi.length, missed };
}

// --- self-test / join diagnostics -------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('lineup-strength.ts')) {
  if (!lineupDataAvailable()) {
    console.error('FIFA CSVs missing under data/fifa/. Fetch them first.');
    process.exit(1);
  }
  const file = path.join(process.cwd(), 'data-lineups', 'lineups.json');
  if (!existsSync(file)) {
    console.error('data-lineups/lineups.json missing. Run tsx scripts/fetch-lineups.ts first.');
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(file, 'utf8')).matches as any[];
  console.log(`Editions loaded: ${editions().map((e) => e.yy).join(', ')}`);
  console.log(`Lineup matches: ${data.length}\n`);

  let starters = 0;
  let matchedStarters = 0;
  // weight a "likely starter / notable" view by rating: collect every starter's
  // matched overall, and track the unmatched ones with the team+edition so we
  // can eyeball whether STARS are dropping out (the thing that matters).
  const unmatched = new Map<string, number>(); // "team|name" -> times unmatched
  let teamsWithRef = 0;
  let teamRows = 0;
  for (const m of data) {
    for (const [team, xi] of [
      [m.home, m.home_xi],
      [m.away, m.away_xi],
    ] as [string, PlayerLite[]][]) {
      teamRows++;
      const s = xiStrength(team, m.date, xi);
      starters += s.total;
      matchedStarters += s.matched;
      if (s.fullXI != null) teamsWithRef++;
      for (const p of s.missed) {
        const key = `${team}|${p.nick ?? p.name}`;
        unmatched.set(key, (unmatched.get(key) ?? 0) + 1);
      }
    }
  }
  console.log('=== JOIN MATCH RATES ===');
  console.log(`Starter match rate (all): ${matchedStarters}/${starters} = ${((100 * matchedStarters) / starters).toFixed(1)}%`);
  console.log(`Team-rows with a full-XI reference: ${teamsWithRef}/${teamRows} = ${((100 * teamsWithRef) / teamRows).toFixed(1)}%`);

  // Which missed players are NOTABLE? Re-derive each unmatched player's rating is
  // impossible (that's why they're unmatched), so proxy "notable" by how often
  // they started in our pilot -- a player who started many pilot games and never
  // matched is a real hole; a one-cap sub is noise.
  console.log('\n=== UNMATCHED STARTERS, by how many pilot games they started (>=2) ===');
  const ranked = [...unmatched.entries()].sort((a, b) => b[1] - a[1]).filter(([, n]) => n >= 2);
  for (const [k, n] of ranked.slice(0, 40)) console.log(`  ${n}x  ${k}`);
  console.log(`  (+${Math.max(0, ranked.length - 40)} more multi-game unmatched; ${unmatched.size} distinct unmatched in total)`);

  // spot-check a few marquee sides: print matched XI strength vs full-strength.
  console.log('\n=== SPOT CHECK: actualXI / fullXI / delta (matched-of-11) ===');
  const samples = data.filter(
    (m) =>
      (m.home === 'Argentina' || m.home === 'France' || m.home === 'Brazil' || m.home === 'Spain') &&
      m.stage === 'Final'
  );
  for (const m of samples.slice(0, 6)) {
    const s = xiStrength(m.home, m.date, m.home_xi);
    console.log(
      `  ${m.date} ${m.competition} ${m.home}: actualXI=${s.actualXI?.toFixed(1)} fullXI=${s.fullXI?.toFixed(1)} delta=${s.delta?.toFixed(2)} (${s.matched}/${s.total})`
    );
  }
}
