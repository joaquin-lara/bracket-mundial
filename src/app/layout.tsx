import type { Metadata, Viewport } from 'next';
import ChallengeWatcher from '@/components/ChallengeWatcher';
import ViewportLock from '@/components/ViewportLock';
import PullToRefresh from '@/components/PullToRefresh';
import HomeOnRefresh from '@/components/HomeOnRefresh';
import PageTransitionProvider from '@/components/PageTransition';
import TopNav from '@/components/TopNav';
import { createClient } from '@/lib/supabase/server';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Stonks Bracket',
    template: '%s · Stonks Bracket',
  },
  description: 'World Cup 2026 prediction game',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  userScalable: false,
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
          <ViewportLock />
          <PullToRefresh />
          <HomeOnRefresh />
          {user && <TopNav />}
          {user && <ChallengeWatcher me={user.id} />}
          {children}
        </PageTransitionProvider>
      </body>
    </html>
  );
}
