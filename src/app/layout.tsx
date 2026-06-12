import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { signOut } from './actions';
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
        {user && (
          <header className="topbar">
            <Link href="/" className="brand">
              <span className="brand-badge">⚽</span>
              <span className="brand-name">Stonks©</span>
            </Link>
            <nav className="topnav">
              <Link href="/today">Today</Link>
              <Link href="/matches">Enter your bracket</Link>
              <Link href="/schedule">Schedule</Link>
              <Link href="/bracket">World Cup Bracket</Link>
              <Link href="/standings">Standings</Link>
              <Link href="/rules">Rules</Link>
              <form action={signOut}>
                <button type="submit">Sign out</button>
              </form>
            </nav>
          </header>
        )}
        {children}
      </body>
    </html>
  );
}
