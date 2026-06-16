import type { Metadata, Viewport } from 'next';
import ChallengeWatcher from '@/components/ChallengeWatcher';
import EnableNotifications from '@/components/EnableNotifications';
import HomeOnRefresh from '@/components/HomeOnRefresh';
import PageTransitionProvider from '@/components/PageTransition';
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
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Stonks Bracket', statusBarStyle: 'black-translucent' },
  icons: { icon: '/icon-192.png', apple: '/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  themeColor: '#0b5f3a',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <html lang="en">
      <body>
        <PageTransitionProvider>
          <HomeOnRefresh />
          {user && <TopNav />}
          {user && <ChallengeWatcher me={user.id} />}
          {user && <PickReminder me={user.id} isGuest={isGuestEmail(user.email)} />}
          {user && <EnableNotifications />}
          {children}
        </PageTransitionProvider>
      </body>
    </html>
  );
}
