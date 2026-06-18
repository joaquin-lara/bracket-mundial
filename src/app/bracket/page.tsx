import type { Metadata } from 'next';
import AsItStands from '@/components/AsItStands';
import CardsEditor, { type CardsRow } from '@/components/CardsEditor';
import GroupTables from '@/components/GroupTables';
import { ensureFreshScores } from '@/lib/autoSync';
import { fairPlayByCode, type DisciplineRow } from '@/lib/fairPlay';
import { flagUrl } from '@/lib/flags';
import { computeGroupTables } from '@/lib/groups';
import { TEAMS } from '@/lib/ml/teams';
import { createClient } from '@/lib/supabase/server';
import type { Match } from '@/lib/types';

export const metadata: Metadata = { title: 'Tournament Tracker' };
export const revalidate = 120; // cache for 2 minutes

const ROUNDS: { stage: string; label: string }[] = [
  { stage: 'LAST_32', label: 'Round of 32' },
  { stage: 'LAST_16', label: 'Round of 16' },
  { stage: 'QUARTER_FINALS', label: 'Quarter-finals' },
  { stage: 'SEMI_FINALS', label: 'Semi-finals' },
  { stage: 'FINAL', label: 'Final' },
];

function TeamFlag({
  code,
  name,
  win,
  dim,
}: {
  code: string | null;
  name: string;
  win?: boolean;
  dim?: boolean;
}) {
  const url = flagUrl(code);
  if (!url) return <span className="b-flagph" />;
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={url}
      alt={`${name} flag`}
      className={`b-flag${win ? ' win' : ''}${dim ? ' dim' : ''}`}
      loading="lazy"
    />
  );
}

function BracketMatch({ m, highlight }: { m: Match; highlight?: boolean }) {
  const live = m.status === 'IN_PLAY' || m.status === 'PAUSED';
  const finished = m.status === 'FINISHED';
  const showScore = (finished || live) && m.home_score != null && m.away_score != null;
  const homeWin = finished && (m.home_score ?? 0) > (m.away_score ?? 0);
  const awayWin = finished && (m.away_score ?? 0) > (m.home_score ?? 0);
  const ko = new Date(m.kickoff);
  const dateLabel = `${ko
    .toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    .toUpperCase()} · ${ko.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;

  return (
    <div className={`b-card${live ? ' live' : ''}${highlight ? ' final-match' : ''}`}>
      <div className="b-top">
        {finished ? (
          <span className="badge-ft">FT</span>
        ) : live ? (
          <span className="b-livepill">
            <span className="b-livedot" />
            LIVE
          </span>
        ) : (
          <span className="b-date">{dateLabel}</span>
        )}
      </div>

      <div className="b-mid">
        <TeamFlag code={m.home_code} name={m.home_team} win={homeWin} dim={awayWin} />
        {showScore ? (
          <div className="b-scoreline">
            <span className={homeWin ? 'win' : ''}>{m.home_score}</span>
            <span className="b-dash">–</span>
            <span className={awayWin ? 'win' : ''}>{m.away_score}</span>
          </div>
        ) : (
          <div className="b-noscore">– : –</div>
        )}
        <TeamFlag code={m.away_code} name={m.away_team} win={awayWin} dim={homeWin} />
      </div>

      <div className="b-codes">
        <span className={homeWin ? 'win' : awayWin ? 'dim' : ''}>{m.home_code ?? 'TBD'}</span>
        <span className={awayWin ? 'win' : homeWin ? 'dim' : ''}>{m.away_code ?? 'TBD'}</span>
      </div>
    </div>
  );
}

export default async function BracketPage() {
  await ensureFreshScores();
  const supabase = createClient();

  const [{ data }, { data: discipline }] = await Promise.all([
    supabase.from('matches').select('*').order('kickoff', { ascending: true }),
    supabase.from('discipline').select('*'),
  ]);

  const allMatches = (data ?? []) as Match[];
  const disciplineRows = (discipline ?? []) as DisciplineRow[];
  const fairPlay = fairPlayByCode(disciplineRows);
  const groupTables = computeGroupTables(allMatches, fairPlay);

  const discByCode = new Map(disciplineRows.map((r) => [r.team_code.toUpperCase(), r]));
  const cardsRows: CardsRow[] = TEAMS.map((t) => {
    const d = discByCode.get(t.code);
    return {
      code: t.code,
      name: t.name,
      yellow: d?.yellow ?? 0,
      second_yellow: d?.second_yellow ?? 0,
      direct_red: d?.direct_red ?? 0,
      yellow_direct_red: d?.yellow_direct_red ?? 0,
    };
  });

  const knockoutStages = new Set([...ROUNDS.map((r) => r.stage), 'THIRD_PLACE']);
  const matches = allMatches.filter((m) => knockoutStages.has(m.stage));
  const byStage = new Map<string, Match[]>();
  for (const m of matches) {
    if (!byStage.has(m.stage)) byStage.set(m.stage, []);
    byStage.get(m.stage)!.push(m);
  }

  const thirdPlace = byStage.get('THIRD_PLACE') ?? [];
  const hasKnockout = matches.length > 0;
  // The real draw has landed once a knockout fixture carries actual teams.
  const hasRealKnockout = matches.some((m) => m.home_team !== 'TBD' && m.away_team !== 'TBD');
  const anyGroupPlayed = allMatches.some((m) => m.group_name && m.status === 'FINISHED');

  return (
    <div className="bracket-page">
      <h1>Tournament Tracker</h1>
      <p className="subtitle">
        Group tables and the road from the Round of 32 to the Final. Fills in automatically as
        the tournament unfolds; winners in gold.
      </p>

      <GroupTables tables={groupTables} />

      {!hasRealKnockout && anyGroupPlayed && (
        <AsItStands tables={groupTables} matches={allMatches} />
      )}

      <div className="groups-head">
        <span className="groups-title">Knockout Stage</span>
        <div className="contenders-line" />
      </div>
      {!hasKnockout ? (
        <p className="empty">The knockout fixtures appear here once the sync loads them.</p>
      ) : (
        <div className="bracket">
          {ROUNDS.map((round, roundIndex) => {
            const roundMatches = byStage.get(round.stage) ?? [];
            const slotClass = `match-slot${roundIndex > 0 ? ' has-in' : ''}${
              roundIndex < ROUNDS.length - 1 ? ' has-out' : ''
            }`;
            return (
              <div className="round" key={round.stage}>
                <div className="round-label">{round.label}</div>
                <div className="round-body">
                  {roundMatches.length === 0 ? (
                    <p className="empty">TBD</p>
                  ) : (
                    roundMatches.map((m) => (
                      <div className={slotClass} key={m.id}>
                        <BracketMatch m={m} highlight={round.stage === 'FINAL'} />
                      </div>
                    ))
                  )}
                  {round.stage === 'SEMI_FINALS' && thirdPlace.length > 0 && (
                    <div className="third-abs">
                      {thirdPlace.map((m) => (
                        <BracketMatch m={m} key={m.id} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="groups-head">
        <span className="groups-title">Card Tracker</span>
        <div className="contenders-line" />
      </div>
      <p className="subtitle">
        Enter each team&apos;s group-stage cards. Fair-play points (FP) are worked out automatically
        — yellow −1, second yellow −3, direct red −4, yellow + red −5 — and break ties in the group
        tables above. Closer to zero is better.
      </p>
      <CardsEditor initial={cardsRows} />
    </div>
  );
}
