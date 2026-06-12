import type { Metadata } from 'next';
import Flag from '@/components/Flag';
import GroupTables from '@/components/GroupTables';
import { ensureFreshScores } from '@/lib/autoSync';
import { computeGroupTables } from '@/lib/groups';
import { createClient } from '@/lib/supabase/server';
import type { Match } from '@/lib/types';

export const metadata: Metadata = { title: 'Group and Bracket Tracker' };
export const revalidate = 120; // cache for 2 minutes

const ROUNDS: { stage: string; label: string }[] = [
  { stage: 'LAST_32', label: 'Round of 32' },
  { stage: 'LAST_16', label: 'Round of 16' },
  { stage: 'QUARTER_FINALS', label: 'Quarter-finals' },
  { stage: 'SEMI_FINALS', label: 'Semi-finals' },
  { stage: 'FINAL', label: 'Final' },
];

function BracketMatch({ m, highlight }: { m: Match; highlight?: boolean }) {
  const live = m.status === 'IN_PLAY' || m.status === 'PAUSED';
  const finished = m.status === 'FINISHED';
  const showScore = finished || live;
  const homeWin = finished && (m.home_score ?? 0) > (m.away_score ?? 0);
  const awayWin = finished && (m.away_score ?? 0) > (m.home_score ?? 0);
  const dateLabel = new Date(m.kickoff).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className={`b-match${highlight ? ' final-match' : ''}`}>
      <div className={`b-team${homeWin ? ' winner' : ''}`}>
        <span className="b-name">
          <Flag code={m.home_code} name={m.home_team} />
          {m.home_team}
        </span>
        <span className="b-score">{showScore ? m.home_score ?? '' : ''}</span>
      </div>
      <div className={`b-team${awayWin ? ' winner' : ''}`}>
        <span className="b-name">
          <Flag code={m.away_code} name={m.away_team} />
          {m.away_team}
        </span>
        <span className="b-score">{showScore ? m.away_score ?? '' : ''}</span>
      </div>
      <div className="b-meta">{finished ? 'FT' : live ? 'Live' : dateLabel}</div>
    </div>
  );
}

export default async function BracketPage() {
  await ensureFreshScores();
  const supabase = createClient();

  const { data } = await supabase
    .from('matches')
    .select('*')
    .order('kickoff', { ascending: true });

  const allMatches = (data ?? []) as Match[];
  const groupTables = computeGroupTables(allMatches);

  const knockoutStages = new Set([...ROUNDS.map((r) => r.stage), 'THIRD_PLACE']);
  const matches = allMatches.filter((m) => knockoutStages.has(m.stage));
  const byStage = new Map<string, Match[]>();
  for (const m of matches) {
    if (!byStage.has(m.stage)) byStage.set(m.stage, []);
    byStage.get(m.stage)!.push(m);
  }

  const thirdPlace = byStage.get('THIRD_PLACE') ?? [];
  const hasKnockout = matches.length > 0;

  return (
    <div className="bracket-page">
      <h1>Group and Bracket Tracker</h1>
      <p className="subtitle">
        Group tables and the road from the Round of 32 to the Final. Fills in automatically as
        the tournament unfolds; winners in gold.
      </p>

      <GroupTables tables={groupTables} />

      <div className="groups-head">
        <span className="groups-title">Knockout Stage</span>
        <div className="contenders-line" />
      </div>

      {!hasKnockout ? (
        <p className="empty">The knockout fixtures appear here once the sync loads them.</p>
      ) : (
        <>
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
                  </div>
                </div>
              );
            })}
          </div>

          {thirdPlace.length > 0 && (
            <div className="third-place">
              <div className="round-label">Third place</div>
              {thirdPlace.map((m) => (
                <BracketMatch m={m} key={m.id} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
