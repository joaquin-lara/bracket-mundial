import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { signOut } from './actions';
import './globals.css';

export const metadata: Metadata = {
  title: 'Bracket Mundial',
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
          <nav className="nav">
            <Link href="/" className="brand">
              Bracket Mundial
            </Link>
            <Link href="/">Today</Link>
            <Link href="/matches">Schedule</Link>
            <Link href="/standings">Standings</Link>
            <form action={signOut}>
              <button type="submit">Sign out</button>
            </form>
          </nav>
        )}
        {children}
      </body>
    </html>
  );
}
