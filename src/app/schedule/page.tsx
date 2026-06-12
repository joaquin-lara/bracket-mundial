import type { Metadata } from 'next';
import ScheduleList from '@/components/ScheduleList';
import { ensureFreshScores } from '@/lib/autoSync';
import { createClient } from '@/lib/supabase/server';
import type { Match } from '@/lib/types';

export const metadata: Metadata = { title: 'Schedule' };
export const revalidate = 60; // cache for 1 minute

export default async function SchedulePage() {
  await ensureFreshScores();
  const supabase = createClient();

  const { data } = await supabase
    .from('matches')
    .select('*')
    .order('kickoff', { ascending: true });

  const matches = (data ?? []) as Match[];

  return (
    <main>
      <h1>Schedule</h1>
      <p className="subtitle">
        Every World Cup 2026 fixture, with live and final scores. Times shown in your timezone.
      </p>
      {matches.length === 0 ? (
        <p className="empty">No fixtures yet. They appear after the first sync runs.</p>
      ) : (
        <ScheduleList matches={matches} />
      )}
    </main>
  );
}
