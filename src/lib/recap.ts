// Match-day recap: a punchy summary of the most recent completed day of
// scoring. Pure — fed the day's scored predictions plus optional achievement
// and duel context the standings page already has on hand.
//
// Scoring key: 3 = exact, 2 = right outcome, 1 = miss (locked, wrong).

export interface RecapInput {
  name: string;
  kickoff: string; // ISO of the match
  points: number; // 1..3, this player's score on that match
  exact: boolean; // predicted the exact score
  upset: boolean; // the underdog won this match (per the model); false if unknown
  homeCode: string | null;
  awayCode: string | null;
  homeScore: number | null;
  awayScore: number | null;
}

export interface RecapAchievement {
  player: string;
  name: string;
  emoji: string;
  at: string; // ISO earned_at
}

export interface RecapDuel {
  winner: string;
  loser: string;
  winnerScore: number;
  loserScore: number;
  at: string; // ISO finished_at
}

export interface RecapContext {
  achievements?: RecapAchievement[];
  duels?: RecapDuel[];
}

export interface RecapLine {
  icon: string;
  text: string;
}

export interface Recap {
  dayLabel: string;
  lines: RecapLine[];
}

const MAX_LINES = 6;
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA');
const plural = (n: number) => (n === 1 ? '' : 's');
const matchKey = (e: RecapInput) => `${e.homeCode}-${e.awayCode}-${e.kickoff}`;

interface PStat {
  pts: number;
  games: number;
  exacts: number;
  outcomes: number;
  misses: number;
}

/**
 * Builds the recap for the latest local day that had at least one scored
 * prediction. Returns null when there is nothing to report yet.
 */
export function buildRecap(entries: RecapInput[], ctx: RecapContext = {}): Recap | null {
  if (entries.length === 0) return null;

  const latestDay = entries.map((e) => dayOf(e.kickoff)).sort().at(-1)!;
  const day = entries.filter((e) => dayOf(e.kickoff) === latestDay);
  if (day.length === 0) return null;

  // ---- per-player stats for the day ----
  const byPlayer = new Map<string, PStat>();
  for (const e of day) {
    const r = byPlayer.get(e.name) ?? { pts: 0, games: 0, exacts: 0, outcomes: 0, misses: 0 };
    r.pts += e.points;
    r.games += 1;
    if (e.exact) r.exacts += 1;
    if (e.points >= 2) r.outcomes += 1;
    if (e.points === 1) r.misses += 1;
    byPlayer.set(e.name, r);
  }
  const players = [...byPlayer.entries()];

  // ---- cumulative totals before & after the day (the title race) ----
  const beforeTotal = new Map<string, number>();
  const afterTotal = new Map<string, number>();
  for (const e of entries) {
    afterTotal.set(e.name, (afterTotal.get(e.name) ?? 0) + e.points);
    if (dayOf(e.kickoff) < latestDay) {
      beforeTotal.set(e.name, (beforeTotal.get(e.name) ?? 0) + e.points);
    }
  }

  const lines: RecapLine[] = [];

  // 1. day leader (or a tie at the top)
  const maxPts = Math.max(...players.map(([, r]) => r.pts));
  if (maxPts > 0) {
    const leaders = players.filter(([, r]) => r.pts === maxPts);
    if (leaders.length === 1) {
      const [n, r] = leaders[0];
      lines.push({
        icon: '⭐',
        text: `${n} led the day with ${r.pts} point${plural(r.pts)} from ${r.games} game${plural(r.games)}.`,
      });
    } else {
      lines.push({
        icon: '🤝',
        text: `${joinNames(leaders.map(([n]) => n))} tied for the day lead with ${maxPts} points.`,
      });
    }
  }

  // 2. pick of the day (gutsiest correct call)
  const correct = day.filter((e) => e.points >= 2 && e.homeScore != null && e.awayScore != null);
  if (correct.length > 0) {
    const exactsPerMatch = new Map<string, number>();
    for (const e of day) {
      if (e.exact) exactsPerMatch.set(matchKey(e), (exactsPerMatch.get(matchKey(e)) ?? 0) + 1);
    }
    const top = correct
      .slice()
      .sort((a, b) => pickScore(b, exactsPerMatch) - pickScore(a, exactsPerMatch))[0];
    const score = `${top.homeCode ?? 'TBD'} ${top.homeScore}–${top.awayScore} ${top.awayCode ?? 'TBD'}`;
    const lone = top.exact && (exactsPerMatch.get(matchKey(top)) ?? 0) === 1;
    const tail = top.exact && top.upset ? ' — a proper upset' : lone ? ' — the only one to see it' : '';
    lines.push({
      icon: '🌟',
      text: `Pick of the day: ${top.name} ${top.exact ? 'nailed' : 'called'} ${score}${tail}.`,
    });
  }

  // 3. head-to-head beatdown (top scorer vs bottom, if there's a real gap)
  if (players.length >= 2) {
    const sorted = players.slice().sort((a, b) => b[1].pts - a[1].pts);
    const [hiN, hi] = sorted[0];
    const [loN, lo] = sorted[sorted.length - 1];
    if (hi.pts - lo.pts >= 3) {
      lines.push({ icon: '⚔️', text: `${hiN} out-scored ${loN} ${hi.pts}–${lo.pts} on the day.` });
    }
  }

  // 4. perfect day (right outcome on every pick, 3+ games)
  const perfect = players
    .filter(([, r]) => r.games >= 3 && r.outcomes === r.games)
    .map(([n, r]) => `${n} (${r.games}/${r.games})`);
  if (perfect.length > 0) {
    lines.push({ icon: '✅', text: `Perfect on outcomes: ${joinNames(perfect)}.` });
  }

  // 5. rough day (every pick a miss)
  const rough = players.filter(([, r]) => r.games >= 3 && r.misses === r.games).map(([n]) => n);
  if (rough.length > 0) {
    lines.push({ icon: '🧱', text: `${joinNames(rough)} whiffed every pick (1 point each).` });
  }

  // 6. exact-score roll call
  const exactCalls = day
    .filter((e) => e.exact && e.homeScore != null && e.awayScore != null)
    .map((e) => `${e.name} called ${e.homeCode ?? 'TBD'} ${e.homeScore}–${e.awayScore} ${e.awayCode ?? 'TBD'}`);
  if (exactCalls.length > 1) {
    lines.push({ icon: '🎯', text: `${exactCalls.slice(0, 3).join('; ')}.` });
  }

  // 7. lone upset caller
  const upsetByMatch = new Map<string, RecapInput[]>();
  for (const e of day) {
    if (e.upset && e.points >= 2 && e.homeScore != null && e.awayScore != null) {
      upsetByMatch.set(matchKey(e), [...(upsetByMatch.get(matchKey(e)) ?? []), e]);
    }
  }
  for (const arr of upsetByMatch.values()) {
    if (arr.length === 1) {
      const e = arr[0];
      const winner = (e.homeScore ?? 0) > (e.awayScore ?? 0) ? e.homeCode : e.awayCode;
      lines.push({ icon: '🗡️', text: `${e.name} was the only one to call ${winner ?? 'the'}'s upset.` });
      break;
    }
  }

  // 8. badges unlocked today
  const badges = (ctx.achievements ?? []).filter((a) => dayOf(a.at) === latestDay);
  if (badges.length > 0) {
    const txt = badges.slice(0, 3).map((a) => `${a.player} unlocked ${a.name} ${a.emoji}`).join('; ');
    lines.push({ icon: '🏅', text: `${txt}.` });
  }

  // 9. title race: new leader + the gap
  if (beforeTotal.size > 0 && afterTotal.size > 0) {
    const leaderBefore = rankOf(beforeTotal)[0];
    const after = [...afterTotal.entries()].sort((a, b) => b[1] - a[1]);
    const leaderAfter = after[0]?.[0];
    if (leaderAfter && leaderBefore && leaderAfter !== leaderBefore) {
      lines.push({ icon: '👑', text: `${leaderAfter} took over 1st place.` });
    }
    if (after.length >= 2) {
      const gap = after[0][1] - after[1][1];
      lines.push({
        icon: '📊',
        text:
          gap === 0
            ? `${after[0][0]} and ${after[1][0]} are dead level at the top.`
            : `${after[0][0]} now leads by ${gap} point${plural(gap)}.`,
      });
    }
  }

  // 10. shootout result today
  const duelsToday = (ctx.duels ?? []).filter((d) => dayOf(d.at) === latestDay);
  if (duelsToday.length > 0) {
    const d = duelsToday[0];
    lines.push({
      icon: '🥅',
      text: `${d.winner} beat ${d.loser} in a shootout, ${d.winnerScore}–${d.loserScore}.`,
    });
  }

  // 11. quiet-day fallback
  if (day.every((e) => !e.exact) && lines.length <= 2) {
    lines.push({ icon: '😴', text: 'A quiet day — nobody nailed a scoreline.' });
  }

  if (lines.length === 0) return null;

  const dayLabel = new Date(`${latestDay}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  return { dayLabel, lines: lines.slice(0, MAX_LINES) };
}

/** Boldness of a correct call: exacts win, then upsets, lone calls, wild scorelines. */
function pickScore(e: RecapInput, exactsPerMatch: Map<string, number>): number {
  let s = e.points === 3 ? 1000 : 0;
  if (e.upset) s += 200;
  const othersExact = Math.max(0, (exactsPerMatch.get(matchKey(e)) ?? 0) - 1);
  if (e.exact && othersExact === 0) s += 60; // lone exact
  const total = (e.homeScore ?? 0) + (e.awayScore ?? 0);
  const margin = Math.abs((e.homeScore ?? 0) - (e.awayScore ?? 0));
  s += total * 4 + margin * 4;
  return s;
}

function rankOf(totals: Map<string, number>): string[] {
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
}

function joinNames(names: string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`;
}
