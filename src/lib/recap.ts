// Match-day recap: a plain, factual summary of the most recent completed
// day of scoring. Pure — fed the same scored-prediction data the standings
// page already loads.

export interface RecapInput {
  name: string;
  kickoff: string; // ISO of the match
  points: number; // 0..3, this player's score on that match
  exact: boolean; // predicted the exact score
  homeCode: string | null;
  awayCode: string | null;
  homeScore: number | null;
  awayScore: number | null;
}

export interface RecapLine {
  icon: string; // emoji marker
  text: string;
}

export interface Recap {
  dayLabel: string;
  lines: RecapLine[];
}

/**
 * Builds the recap for the latest local day that had at least one scored
 * prediction. Returns null when there is nothing to report yet.
 */
export function buildRecap(entries: RecapInput[]): Recap | null {
  if (entries.length === 0) return null;

  const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA');
  const latestDay = entries.map((e) => dayOf(e.kickoff)).sort().at(-1)!;
  const day = entries.filter((e) => dayOf(e.kickoff) === latestDay);
  if (day.length === 0) return null;

  // points per player that day
  const byPlayer = new Map<string, { pts: number; games: number; exacts: number }>();
  for (const e of day) {
    const rec = byPlayer.get(e.name) ?? { pts: 0, games: 0, exacts: 0 };
    rec.pts += e.points;
    rec.games += 1;
    if (e.exact) rec.exacts += 1;
    byPlayer.set(e.name, rec);
  }

  const lines: RecapLine[] = [];
  const players = [...byPlayer.entries()];

  // top scorer of the day
  const top = players.slice().sort((a, b) => b[1].pts - a[1].pts)[0];
  if (top && top[1].pts > 0) {
    lines.push({
      icon: '⭐',
      text: `${top[0]} led the day with ${top[1].pts} point${top[1].pts === 1 ? '' : 's'} from ${top[1].games} game${top[1].games === 1 ? '' : 's'}.`,
    });
  }

  // anyone shut out on a day with games
  const blanks = players.filter(([, r]) => r.games >= 2 && r.pts === 0).map(([n]) => n);
  if (blanks.length > 0) {
    lines.push({
      icon: '🥶',
      text: `${joinNames(blanks)} scored 0 points.`,
    });
  }

  // exact-score calls
  const exactCalls = day
    .filter((e) => e.exact && e.homeScore != null && e.awayScore != null)
    .map(
      (e) =>
        `${e.name} called ${e.homeCode ?? 'TBD'} ${e.homeScore}–${e.awayScore} ${e.awayCode ?? 'TBD'} exactly`
    );
  if (exactCalls.length > 0) {
    lines.push({ icon: '🎯', text: `${exactCalls.slice(0, 3).join('; ')}.` });
  }

  if (lines.length === 0) return null;

  const dayLabel = new Date(`${latestDay}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  return { dayLabel, lines };
}

function joinNames(names: string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`;
}
