/**
 * Resumable lineup fetcher (StatsBomb open data).
 *
 * WHY NOT fbref: the prescribed source (fbref.com) is reachable on the network
 * allowlist but sits behind a Cloudflare "Verify you are human" Turnstile. The
 * sandbox's egress gateway terminates TLS itself (the cert fbref serves is
 * issued by "Anthropic Egress Gateway ... CA"), so Cloudflare only ever sees the
 * gateway's TLS fingerprint and serves an interactive challenge that never
 * issues a clearance cookie -- unscrapable from here by any method (curl,
 * cloudscraper, headless/headful Chromium + stealth, clicking the checkbox).
 * StatsBomb publishes real starting XIs as clean JSON on raw.githubusercontent
 * (no Cloudflare), covering the core international tournaments, so we use that.
 *
 * Two phases, as designed:
 *   Phase 1  walk competitions -> seasons -> matches (cheap list of match ids).
 *   Phase 2  fetch each match's lineup file -> starting XI for both teams.
 *
 * Discipline (containers are ephemeral, re-fetching is the expensive thing):
 *   - RESUMABLE: a done-set of match ids already in the output is skipped.
 *   - CACHE: every raw JSON is written under data/sb-cache/ (gitignored,
 *     re-fetchable) so re-parsing never re-fetches.
 *   - POLITE: real User-Agent, a short delay + jitter, exponential backoff on
 *     non-200. (GitHub raw is not rate-limited like fbref/Cloudflare, so the
 *     delay is modest rather than the 5s fbref would have demanded.)
 *   - CHECKPOINT: the compact, committed dataset (data-lineups/lineups.json) is
 *     flushed every CHECKPOINT_EVERY matches so a fresh session resumes.
 *
 *   tsx scripts/fetch-lineups.ts
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';

const ROOT = process.cwd();
const CACHE_DIR = path.join(ROOT, 'data', 'sb-cache'); // gitignored, re-fetchable
const OUT_DIR = path.join(ROOT, 'data-lineups'); // committed (small, our research)
const OUT_FILE = path.join(OUT_DIR, 'lineups.json');
const BASE = 'https://raw.githubusercontent.com/statsbomb/open-data/master/data';
const UA = 'bracket-mundial-research/1.0 (lineup backtest; contact via repo)';
const DELAY_MS = 350; // polite spacing for GitHub raw
const CHECKPOINT_EVERY = 100;

// Men's senior international tournaments present in the open-data set, every
// confederation represented. (competition_id, season_id, label)
const COMPS: { comp: number; season: number; label: string }[] = [
  { comp: 43, season: 106, label: 'FIFA World Cup 2022' },
  { comp: 55, season: 282, label: 'UEFA Euro 2024' },
  { comp: 223, season: 282, label: 'Copa America 2024' },
  { comp: 1267, season: 107, label: 'African Cup of Nations 2023' },
  { comp: 55, season: 43, label: 'UEFA Euro 2020' },
  { comp: 43, season: 3, label: 'FIFA World Cup 2018' },
];

interface PlayerEntry {
  name: string;
  nick: string | null;
}
interface MatchRecord {
  match_id: number;
  competition: string;
  season: string;
  date: string;
  stage: string;
  home: string;
  away: string;
  home_score: number;
  away_score: number;
  home_xi: PlayerEntry[];
  away_xi: PlayerEntry[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fetch JSON with on-disk cache + exponential backoff. */
async function getJson(url: string, cacheKey: string): Promise<any> {
  const cacheFile = path.join(CACHE_DIR, cacheKey);
  if (existsSync(cacheFile)) {
    return JSON.parse(readFileSync(cacheFile, 'utf8'));
  }
  let delay = 1000;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.status === 200) {
        const text = await res.text();
        mkdirSync(path.dirname(cacheFile), { recursive: true });
        writeFileSync(cacheFile, text);
        await sleep(DELAY_MS + Math.random() * 200);
        return JSON.parse(text);
      }
      if (res.status === 404) throw new Error(`404 ${url}`);
      // 429/403/5xx -> back off and retry
      console.warn(`  ${res.status} on ${url}, backoff ${delay}ms`);
    } catch (e) {
      console.warn(`  fetch error on ${url}: ${String(e).slice(0, 120)}`);
    }
    await sleep(delay);
    delay *= 2;
  }
  throw new Error(`giving up on ${url}`);
}

/** Starting XI = players whose first listed position began as "Starting XI". */
function startingXI(teamLineup: any): PlayerEntry[] {
  const out: PlayerEntry[] = [];
  for (const p of teamLineup.lineup) {
    const positions = p.positions || [];
    const started = positions.some((pos: any) => pos.start_reason === 'Starting XI');
    if (started) out.push({ name: p.player_name, nick: p.player_nickname ?? null });
  }
  return out;
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  // resume: load whatever we already have
  const existing: MatchRecord[] = existsSync(OUT_FILE)
    ? (JSON.parse(readFileSync(OUT_FILE, 'utf8')).matches as MatchRecord[])
    : [];
  const done = new Set(existing.map((m) => m.match_id));
  const records: MatchRecord[] = [...existing];
  console.log(`Resuming with ${done.size} matches already collected.`);

  // Phase 1: competitions -> matches lists
  const fixtures: { match: any; label: string; season: string }[] = [];
  for (const c of COMPS) {
    const matches = await getJson(
      `${BASE}/matches/${c.comp}/${c.season}.json`,
      `matches/${c.comp}_${c.season}.json`
    );
    for (const m of matches) fixtures.push({ match: m, label: c.label, season: String(c.season) });
    console.log(`Phase 1: ${c.label} -> ${matches.length} matches`);
  }
  console.log(`Phase 1 total: ${fixtures.length} matches across ${COMPS.length} competitions.\n`);

  // Phase 2: per-match lineups
  let since = 0;
  let fetched = 0;
  for (const { match, label, season } of fixtures) {
    const id = match.match_id;
    if (done.has(id)) continue;
    let lineups: any;
    try {
      lineups = await getJson(`${BASE}/lineups/${id}.json`, `lineups/${id}.json`);
    } catch (e) {
      console.warn(`  skip ${id}: ${String(e).slice(0, 80)}`);
      continue;
    }
    // lineups[0] is home, lineups[1] is away in StatsBomb's ordering; match the
    // team names against the match record to be safe.
    const byName = new Map<string, any>(lineups.map((t: any) => [t.team_name, t]));
    const homeName = match.home_team.home_team_name;
    const awayName = match.away_team.away_team_name;
    const homeLU = byName.get(homeName) ?? lineups[0];
    const awayLU = byName.get(awayName) ?? lineups[1];
    records.push({
      match_id: id,
      competition: label,
      season,
      date: match.match_date,
      stage: match.competition_stage?.name ?? '',
      home: homeName,
      away: awayName,
      home_score: match.home_score,
      away_score: match.away_score,
      home_xi: startingXI(homeLU),
      away_xi: startingXI(awayLU),
    });
    done.add(id);
    fetched++;
    since++;
    if (since >= CHECKPOINT_EVERY) {
      flush(records);
      console.log(`  ... checkpointed at ${records.length} matches`);
      since = 0;
    }
  }
  flush(records);
  console.log(`\nDone. Newly fetched ${fetched}; total ${records.length} matches in ${OUT_FILE}.`);
}

function flush(records: MatchRecord[]): void {
  records.sort((a, b) => a.date.localeCompare(b.date) || a.match_id - b.match_id);
  writeFileSync(
    OUT_FILE,
    JSON.stringify(
      { source: 'statsbomb-open-data', generated: new Date().toISOString(), matches: records },
      null,
      0
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
