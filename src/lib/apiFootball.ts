// API-Football (api-sports.io) client — confirmed match lineups for the World
// Cup. Free tier is 100 requests/day, so callers MUST be frugal: see lineupSync.
// Lineups publish 20-40 min before kickoff, update only once, and never change
// after, so we fetch a match exactly once and cache it forever.

const BASE = 'https://v3.football.api-sports.io';
const WC_LEAGUE = 1; // FIFA World Cup
const WC_SEASON = 2026;

export interface LineupPlayer { name: string; pos: string; grid: string | null; number: number | null }
export interface TeamLineup { teamName: string; formation: string; startXI: LineupPlayer[] }
export interface MatchLineups { home: TeamLineup; away: TeamLineup }

interface AfEnvelope<T> { errors: unknown; results: number; response: T }

async function af<T>(path: string, key: string): Promise<AfEnvelope<T>> {
  const res = await fetch(`${BASE}${path}`, { headers: { 'x-apisports-key': key }, cache: 'no-store' });
  if (!res.ok) throw new Error(`api-football ${path} -> ${res.status}`);
  return (await res.json()) as AfEnvelope<T>;
}

interface AfFixture { fixture: { id: number; date: string }; teams: { home: { name: string }; away: { name: string } } }

/** All WC 2026 fixtures with API-Football ids, for mapping to our football-data rows. */
export async function fetchWcFixtures(key: string): Promise<{ id: number; date: string; home: string; away: string }[]> {
  const env = await af<AfFixture[]>(`/fixtures?league=${WC_LEAGUE}&season=${WC_SEASON}`, key);
  return (env.response ?? []).map((f) => ({
    id: f.fixture.id,
    date: f.fixture.date,
    home: f.teams.home.name,
    away: f.teams.away.name,
  }));
}

interface AfLineup {
  team: { name: string };
  formation: string;
  startXI: { player: { name: string; pos: string; grid: string | null; number: number | null } }[];
}

/**
 * Confirmed lineups for one fixture, or null if not published yet. The two
 * entries are matched to home/away by team name via `resolve` (our lookup).
 */
export async function fetchLineups(
  afFixtureId: number,
  key: string,
  resolveCode: (name: string) => string | null,
  homeCode: string,
  awayCode: string
): Promise<MatchLineups | null> {
  const env = await af<AfLineup[]>(`/fixtures/lineups?fixture=${afFixtureId}`, key);
  const list = env.response ?? [];
  if (list.length < 2) return null; // not posted yet

  const toTeam = (l: AfLineup): TeamLineup => ({
    teamName: l.team.name,
    formation: l.formation,
    startXI: (l.startXI ?? []).map((s) => ({
      name: s.player.name,
      pos: s.player.pos,
      grid: s.player.grid,
      number: s.player.number,
    })),
  });

  let home: TeamLineup | null = null;
  let away: TeamLineup | null = null;
  for (const l of list) {
    const code = resolveCode(l.team.name);
    if (code === homeCode) home = toTeam(l);
    else if (code === awayCode) away = toTeam(l);
  }
  // Fall back to response order if names didn't resolve cleanly.
  if (!home || !away) {
    home = home ?? toTeam(list[0]);
    away = away ?? toTeam(list[1]);
  }
  if (!home.startXI.length || !away.startXI.length) return null;
  return { home, away };
}
