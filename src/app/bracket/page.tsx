import type { Metadata } from 'next';
import AsItStands from '@/components/AsItStands';
import CardsEditor, { type CardsRow } from '@/components/CardsEditor';
import GroupTables from '@/components/GroupTables';
import KnockoutSection from '@/components/KnockoutSection';
import { ensureFreshScores } from '@/lib/autoSync';
import { fairPlayByCode, type DisciplineRow } from '@/lib/fairPlay';
import { computeGroupTables } from '@/lib/groups';
import { TEAMS } from '@/lib/ml/teams';
import { projectBracket } from '@/lib/qualification';
import { createClient } from '@/lib/supabase/server';
import type { Match } from '@/lib/types';

export const metadata: Metadata = { title: 'Tournament Tracker' };
export const revalidate = 120; // cache for 2 minutes

const KNOCKOUT_STAGES = new Set(['LAST_32', 'LAST_16', 'QUARTER_FINALS', 'SEMI_FINALS', 'FINAL', 'THIRD_PLACE']);

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

  const knockoutMatches = allMatches.filter((m) => KNOCKOUT_STAGES.has(m.stage));
  const byStageMap = new Map<string, typeof knockoutMatches>();
  for (const m of knockoutMatches) {
    if (!byStageMap.has(m.stage)) byStageMap.set(m.stage, []);
    byStageMap.get(m.stage)!.push(m);
  }
  const byStage = [...byStageMap.entries()]
    .filter(([s]) => s !== 'THIRD_PLACE')
    .map(([stage, matches]) => ({ stage, matches }));
  const thirdPlace = byStageMap.get('THIRD_PLACE') ?? [];

  const hasRealKnockout = knockoutMatches.some((m) => m.home_team !== 'TBD' && m.away_team !== 'TBD');
  const anyGroupPlayed = allMatches.some((m) => m.group_name && m.status === 'FINISHED');
  const projected = projectBracket(groupTables);

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

      <KnockoutSection
        byStage={byStage}
        thirdPlace={thirdPlace}
        projected={projected}
        showToggle={!hasRealKnockout && anyGroupPlayed}
      />

      <CardsEditor initial={cardsRows} />
    </div>
  );
}
