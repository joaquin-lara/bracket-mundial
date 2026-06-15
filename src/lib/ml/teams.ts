// Team registry for the predictor. Wraps the generated ratings.json and gives
// the rest of the app a clean lookup by either TLA code (the join key with the
// live fixtures table) or country name, however it happens to be spelled.

import ratings from './ratings.json';

export interface TeamForm {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  recent: { date: string; opp: string; gf: number; ga: number }[];
}

export interface TeamRating {
  name: string;
  code: string;
  elo: number;
  matches: number;
  lastPlayed: string;
  globalRank: number | null;
  /** Dixon-Coles attack rating (log-goal space): higher = scores more. */
  dcAtt: number;
  /** Dixon-Coles defense rating (log-goal space): higher = concedes less. */
  dcDef: number;
  form: TeamForm;
}

export interface DixonColesConstants {
  base: number; // log baseline goals per team
  home: number; // home advantage in log-goal space
  rho: number; // low-score (draw) correction
}

export interface ModelConstants {
  homeAdvantageElo: number;
  goalsPerElo: number;
  avgTotalGoals: number;
  homeMarginGoals: number;
  eloBaseline: number;
  dc: DixonColesConstants;
}

export const MODEL: ModelConstants = ratings.model;
export const DATASET = {
  source: ratings.source,
  matchesProcessed: ratings.matchesProcessed,
  dateRange: ratings.dateRange as [string, string],
  generatedAt: ratings.generatedAt,
  totalRankedTeams: ratings.totalRankedTeams,
};

const BY_CODE = ratings.teams as Record<string, TeamRating>;

/** All 48 WC 2026 teams, alphabetical by name. */
export const TEAMS: TeamRating[] = Object.values(BY_CODE).sort((a, b) =>
  a.name.localeCompare(b.name)
);

// Strip accents/punctuation/case so "Côte d'Ivoire" and "Ivory Coast" can be
// reconciled. Aliases below cover the spellings football-data / openfootball
// use that differ from the dataset's.
function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const ALIASES: Record<string, string> = {
  // football-data / common variants -> TLA code
  usa: 'USA', unitedstates: 'USA', unitedstatesofamerica: 'USA',
  korearepublic: 'KOR', southkorea: 'KOR', republicofkorea: 'KOR',
  irian: 'IRN', iran: 'IRN', iririan: 'IRN', islamicrepublicofiran: 'IRN',
  cotedivoire: 'CIV', ivorycoast: 'CIV',
  ecuador: 'ECU',
  czechia: 'CZE', czechrepublic: 'CZE',
  turkiye: 'TUR', turkey: 'TUR',
  caboverde: 'CPV', capeverde: 'CPV', capeverdeislands: 'CPV',
  bosniaherzegovina: 'BIH', bosniaandherzegovina: 'BIH',
  drcongo: 'COD', congodr: 'COD', democraticrepublicofthecongo: 'COD', congodemocraticrepublic: 'COD',
  curacao: 'CUR', cuw: 'CUR', // football-data serves Curaçao's TLA as CUW; dataset uses CUR
  saudiarabia: 'KSA',
  southafrica: 'RSA',
  newzealand: 'NZL',
};

// Build a normalized-name -> code index from the dataset names themselves.
const NAME_INDEX: Record<string, string> = {};
for (const t of TEAMS) NAME_INDEX[norm(t.name)] = t.code;

/**
 * Resolve any team identifier (TLA code or country name, any spelling) to a
 * rating, or null if it is not one of the 48 qualified teams.
 */
export function lookup(idOrName: string | null | undefined): TeamRating | null {
  if (!idOrName) return null;
  const raw = idOrName.trim();
  if (BY_CODE[raw.toUpperCase()]) return BY_CODE[raw.toUpperCase()];
  const n = norm(raw);
  const code = ALIASES[n] ?? NAME_INDEX[n];
  return code ? BY_CODE[code] : null;
}

export function byCode(code: string): TeamRating | null {
  return BY_CODE[code] ?? null;
}
