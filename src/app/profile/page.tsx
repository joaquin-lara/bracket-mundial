import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import ProfileEditor from '@/components/ProfileEditor';
import { PLAYER_META, PLAYERS, isGuestEmail } from '@/lib/players';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Profile' };
export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Guests have no profile to edit.
  if (!user || isGuestEmail(user.email)) redirect('/');

  const { data: prof } = await supabase
    .from('profiles')
    .select('display_name, flag_code, founder_slot')
    .eq('id', user.id)
    .maybeSingle();

  const slot = (prof?.founder_slot as string | null) ?? null;
  const name = (prof?.display_name as string | null) ?? slot ?? '';
  // Fall back to the founder's hardcoded flag if they haven't picked one yet.
  const flag =
    (prof?.flag_code as string | null) ??
    (slot && PLAYERS.includes(slot as (typeof PLAYERS)[number])
      ? PLAYER_META[slot as (typeof PLAYERS)[number]].flagCode
      : '');

  return (
    <main>
      <h1>Your profile</h1>
      <p className="subtitle">Change your name or flag, or delete your account.</p>
      <ProfileEditor initialName={name} initialFlag={flag} />
    </main>
  );
}
