import type { Metadata } from 'next';
import ChallengeWatcher from '@/components/ChallengeWatcher';
import HomeOnRefresh from '@/components/HomeOnRefresh';
import PickReminder from '@/components/PickReminder';
import TopNav from '@/components/TopNav';
import { isGuestEmail } from '@/lib/players';
import { createClient } from '@/lib/supabase/server';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Stonks Bracket',
    template: '%s · Stonks Bracket',
  },
  description: 'World Cup 2026 prediction game',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <html lang="en">
      <body>
        <HomeOnRefresh />
        {user && <TopNav />}
        {user && <ChallengeWatcher me={user.id} />}
        {user && <PickReminder me={user.id} isGuest={isGuestEmail(user.email)} />}
        {children}
      </body>
    </html>
  );
}
