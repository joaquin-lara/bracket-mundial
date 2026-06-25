// API-Football (api-sports.io) client — confirmed match lineups and final
// match statistics for the World Cup. Free tier is 100 requests/day, so
// callers MUST be frugal: see lineupSync and statsSync.
// Lineups publish 20-40 min before kickoff, update only once, and never change
// after, so we fetch a match exactly once and cache it forever. Statistics are
// fetched once a match is FINISHED, by fixture id (not a search query, so it
// works outside the free tier's "current live fixtures only" restriction),
// and likewise cached forever.

const BASE = 'https://v3.football.api-sports.io';
const WC_LEAGUE = 1; // FIFA World Cup

export interface LineupPlayer { name: string; pos: string; grid: string | null; number: number | null }
export interface TeamLineup { teamName: string; formation: string; startXI: LineupPlayer[] }
export interface MatchLineups { home: TeamLineup; away: TeamLineup }

export interface TeamMatchStats {
  shotsOnGoal: number | null;
  shotsOffGoal: number | null;
  totalShots: number | null;
  blockedShots: number | null;
  shotsInsideBox: number | null;
  shotsOutsideBox: number | null;
  fouls: number | null;
  cornerKicks: number | null;
  offsides: number | null;
  possession: number | null;
  yellowCards: number | null;
  redCards: number | null;
  goalkeeperSaves: number | null;
}
export interface MatchStats { home: TeamMatchStats; away: TeamMatchStats }

interface AfEnvelope<T> { errors: unknown; results: number; response: T }

async function af<T>(path: string, key: string): Promise<AfEnvelope<T>> {
  const res = await fetch(`${BASE}${path}`, { headers: { 'x-apisports-key': key }, cache: 'no-store' });
  if (!res.ok) throw new Error(`api-football ${path} -> ${res.status}`);
  return (await res.json()) as AfEnvelope<T>;
}

interface AfFixture {
  fixture: { id: number; date: string };
  league?: { id: number };
  teams: { home: { name: string }; away: { name: string } };
}

/**
 * Currently-live World Cup fixtures with their API-Football ids, for mapping to
 * our football-data rows. The free tier only serves `?live=all` (season/date
 * queries return nothing for the current season), so this is the one source.
 */
export async function fetchWcFixtures(key: string): Promise<{ id: number; date: string; home: string; away: string }[]> {
  const live = await af<AfFixture[]>(`/fixtures?live=all`, key);
  return (live.response ?? [])
    .filter((f) => f.league?.id === WC_LEAGUE)
    .map((f) => ({ id: f.fixture.id, date: f.fixture.date, home: f.teams.home.name, away: f.teams.away.name }));
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

interface AfStatEntry { type: string; value: number | string | null }
interface AfTeamStats { team: { name: string }; statistics: AfStatEntry[] }

// API-Football's stat "type" strings -> our field names. Anything not in
// this map (e.g. "Expected goals", "Passes %") is ignored.
const STAT_FIELD_BY_TYPE: Record<string, keyof TeamMatchStats> = {
  'Shots on Goal': 'shotsOnGoal',
  'Shots off Goal': 'shotsOffGoal',
  'Total Shots': 'totalShots',
  'Blocked Shots': 'blockedShots',
  'Shots insidebox': 'shotsInsideBox',
  'Shots outsidebox': 'shotsOutsideBox',
  'Fouls': 'fouls',
  'Corner Kicks': 'cornerKicks',
  'Offsides': 'offsides',
  'Ball Possession': 'possession',
  'Yellow Cards': 'yellowCards',
  'Red Cards': 'redCards',
  'Goalkeeper Saves': 'goalkeeperSaves',
};

function toTeamMatchStats(entries: AfStatEntry[]): TeamMatchStats {
  const out: TeamMatchStats = {
    shotsOnGoal: null, shotsOffGoal: null, totalShots: null, blockedShots: null,
    shotsInsideBox: null, shotsOutsideBox: null, fouls: null, cornerKicks: null,
    offsides: null, possession: null, yellowCards: null, redCards: null, goalkeeperSaves: null,
  };
  for (const e of entries) {
    const field = STAT_FIELD_BY_TYPE[e.type];
    if (!field || e.value == null) continue;
    if (field === 'possession') {
      const n = Number(String(e.value).replace('%', ''));
      out.possession = Number.isFinite(n) ? n : null;
    } else {
      const n = Number(e.value);
      out[field] = Number.isFinite(n) ? n : null;
    }
  }
  return out;
}

/**
 * Final match statistics for one fixture, or null if not available. Unlike
 * lineups, this is meant to be called once a match is FINISHED -- the two
 * entries are matched to home/away by team name via `resolve`, same as
 * fetchLineups.
 */
export async function fetchStatistics(
  afFixtureId: number,
  key: string,
  resolveCode: (name: string) => string | null,
  homeCode: string,
  awayCode: string
): Promise<MatchStats | null> {
  const env = await af<AfTeamStats[]>(`/fixtures/statistics?fixture=${afFixtureId}`, key);
  const list = env.response ?? [];
  if (list.length < 2) return null; // not available yet

  let home: TeamMatchStats | null = null;
  let away: TeamMatchStats | null = null;
  for (const t of list) {
    const code = resolveCode(t.team.name);
    if (code === homeCode) home = toTeamMatchStats(t.statistics);
    else if (code === awayCode) away = toTeamMatchStats(t.statistics);
  }
  if (!home || !away) {
    home = home ?? toTeamMatchStats(list[0].statistics);
    away = away ?? toTeamMatchStats(list[1].statistics);
  }
  return { home, away };
}
