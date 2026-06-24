import type { Metadata } from 'next';
import DuelArena, { type Profile as DuelProfile } from '@/components/DuelArena';
import { createClient } from '@/lib/supabase/server';
import { isGuestEmail } from '@/lib/players';

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

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, display_name, color, flag_code, founder_slot, status');

  return (
    <main>
      <DuelArena
        me={user.id}
        profiles={(profiles ?? []) as DuelProfile[]}
        initialDuelId={searchParams.duel ?? null}
        isGuest={isGuestEmail(user.email)}
      />
    </main>
  );
}
