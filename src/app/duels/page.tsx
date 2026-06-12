import type { Metadata } from 'next';
import DuelArena from '@/components/DuelArena';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Penalty Shootouts' };
export const dynamic = 'force-dynamic';

export default async function DuelsPage({
  searchParams,
}: {
  searchParams: { duel?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profiles } = await supabase.from('profiles').select('id, display_name');

  return (
    <main>
      <h1>Penalty Shootouts</h1>
      <p className="subtitle">
        Challenge a bro to a best-of-5 shootout. Pick in secret, reveal together. Bragging rights
        only.
      </p>
      <DuelArena
        me={user.id}
        profiles={(profiles ?? []) as { id: string; display_name: string }[]}
        initialDuelId={searchParams.duel ?? null}
      />
    </main>
  );
}
