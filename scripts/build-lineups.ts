/**
 * Pre-compute each World Cup 2026 team's most recent known starting formation and
 * XI from the scraped fbref lineups, so the matchup view can show a tactical
 * "projected lineup" without a live team-sheet feed. Reads lineups/fbref_lineups.json
 * (committed), writes public/lineups.json keyed by TLA code.
 *
 * Starters come number-ordered (the goalkeeper reliably first), so the UI draws
 * the formation *shape* and labels the keeper, then lists the full XI.
 *
 *   tsx scripts/build-lineups.ts
 */
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { lookup, TEAMS } from '../src/lib/ml/teams';

const ROOT = process.cwd();
const IN = path.join(ROOT, 'lineups', 'fbref_lineups.json');
const OUT = path.join(ROOT, 'public', 'lineups.json');

interface Starter { num: string; name: string }
interface TeamLineup { code: string; date: string; formation: string; starters: { num: string; name: string }[] }

interface RawLineup { team: string; formation?: string; starters?: Starter[] }
interface RawMatch { date: string; lineups?: RawLineup[] }

function main() {
  const data = JSON.parse(readFileSync(IN, 'utf8')) as Record<string, RawMatch>;
  const latest = new Map<string, TeamLineup>();

  for (const key of Object.keys(data)) {
    const m = data[key];
    if (!m?.date || !Array.isArray(m.lineups)) continue;
    for (const lu of m.lineups) {
      const t = lookup(lu.team);
      if (!t || !lu.formation || !Array.isArray(lu.starters) || lu.starters.length < 11) continue;
      const prev = latest.get(t.code);
      if (prev && prev.date >= m.date) continue;
      latest.set(t.code, {
        code: t.code,
        date: m.date,
        formation: lu.formation,
        starters: lu.starters.slice(0, 11).map((s) => ({ num: s.num, name: s.name })),
      });
    }
  }

  const out: Record<string, TeamLineup> = {};
  for (const [k, v] of latest) out[k] = v;
  writeFileSync(OUT, JSON.stringify(out));
  const missing = TEAMS.filter((t) => !latest.has(t.code)).map((t) => t.code);
  console.log(`Wrote ${OUT}: ${latest.size}/${TEAMS.length} teams, ${(JSON.stringify(out).length / 1024).toFixed(0)} KB`);
  if (missing.length) console.log(`No lineup for: ${missing.join(' ')}`);
}

main();
