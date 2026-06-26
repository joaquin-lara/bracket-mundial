import type { Metadata, Viewport } from 'next';
import AchievementWatcher from '@/components/AchievementWatcher';
import AutoRefresh from '@/components/AutoRefresh';
import ChallengeWatcher from '@/components/ChallengeWatcher';
import ChatBubble from '@/components/ChatBubble';
import ClippyAssistant from '@/components/ClippyAssistant';
import EnableNotifications from '@/components/EnableNotifications';
import HomeOnRefresh from '@/components/HomeOnRefresh';
import PageTransitionProvider from '@/components/PageTransition';
import PendingApproval from '@/components/PendingApproval';
import TopNav from '@/components/TopNav';
import ViewportLock from '@/components/ViewportLock';
import { createClient } from '@/lib/supabase/server';
import { isAchievementsPreviewUser, isGuestEmail } from '@/lib/players';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Stonks Bracket',
    template: '%s · Stonks Bracket',
  },
  description: 'World Cup 2026 prediction game',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Stonks Bracket', statusBarStyle: 'black-translucent' },
  // Favicon + apple-touch-icon come from src/app/icon.png and src/app/apple-icon.png
  // (Next's file convention) -- the most reliable way to get the icon onto iOS.
};

export const viewport: Viewport = {
  themeColor: '#0b5f3a',
  width: 'device-width',
  initialScale: 1,
  userScalable: false,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let achievementsRevealed = false;
  let signupStatus: string | null = null;
  if (user) {
    const { data: st } = await supabase
      .from('achievements_state')
      .select('revealed_at')
      .eq('id', 1)
      .maybeSingle();
    achievementsRevealed = !!st?.revealed_at || isAchievementsPreviewUser(user.email);

    const { data: prof } = await supabase
      .from('profiles')
      .select('status')
      .eq('id', user.id)
      .maybeSingle();
    signupStatus = (prof?.status as string | undefined) ?? null;
  }

  // A signed-in player whose sign-up isn't approved sees only the waiting
  // screen. Unknown/missing status is treated as approved (founders, guest).
  const blocked = !!user && (signupStatus === 'pending' || signupStatus === 'rejected');

  return (
    <html lang="en">
      <body>
        <PageTransitionProvider>
          <ViewportLock />
          {blocked ? (
            <PendingApproval rejected={signupStatus === 'rejected'} />
          ) : (
            <>
              <HomeOnRefresh />
              <AutoRefresh />
              {user && <TopNav achievementsRevealed={achievementsRevealed} isGuest={isGuestEmail(user.email)} />}
              {user && <ChallengeWatcher me={user.id} />}
              {user && <AchievementWatcher me={user.id} />}
              {user && <EnableNotifications />}
              {user && !isGuestEmail(user.email) && <ChatBubble me={user.id} />}
              {user && <ClippyAssistant />}
              {children}
            </>
          )}
        </PageTransitionProvider>
      </body>
    </html>
  );
}
