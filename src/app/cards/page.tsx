import type { Metadata } from 'next';
import CardsEditor, { type CardsRow } from '@/components/CardsEditor';
import type { DisciplineRow } from '@/lib/fairPlay';
import { TEAMS } from '@/lib/ml/teams';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Card Tracker' };
export const dynamic = 'force-dynamic';

export default async function CardsPage() {
  const supabase = createClient();
  const { data } = await supabase.from('discipline').select('*');
  const byCode = new Map(((data ?? []) as DisciplineRow[]).map((r) => [r.team_code.toUpperCase(), r]));

  const rows: CardsRow[] = TEAMS.map((t) => {
    const d = byCode.get(t.code);
    return {
      code: t.code,
      name: t.name,
      yellow: d?.yellow ?? 0,
      second_yellow: d?.second_yellow ?? 0,
      direct_red: d?.direct_red ?? 0,
      yellow_direct_red: d?.yellow_direct_red ?? 0,
    };
  });

  return (
    <div className="cards-page">
      <h1>Card Tracker</h1>
      <p className="subtitle">
        Enter each team&apos;s cards from the group stage. The fair-play points (FP) are worked out
        automatically — yellow −1, second yellow −3, direct red −4, yellow + red −5 — and feed the
        group-stage tiebreaker. Closer to zero is better.
      </p>
      <CardsEditor initial={rows} />
    </div>
  );
}
