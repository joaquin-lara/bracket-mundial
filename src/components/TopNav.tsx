'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { signOut } from '@/app/actions';

const LINKS = [
  ['/matches', 'Edit your bracket'],
  ['/bracket', 'World Cup Bracket'],
  ['/schedule', 'Game schedule'],
  ['/standings', 'Player Standings'],
  ['/rules', 'Rules'],
] as const;

export default function TopNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Slide up when a tab is picked (route change).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <header className="topbar">
      <button
        className="burger"
        aria-label="Menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span />
        <span />
        <span />
      </button>

      <Link href="/" className="brand" onClick={() => setOpen(false)}>
        <span className="brand-badge">⚽</span>
        <span className="brand-name">Stonks©</span>
      </Link>

      <nav className="topnav desktop-nav">
        {LINKS.map(([href, label]) => (
          <Link href={href} key={href} className={pathname === href ? 'active' : ''}>
            {label}
          </Link>
        ))}
        <form action={signOut}>
          <button type="submit">Sign out</button>
        </form>
      </nav>

      <span className="burger-spacer" />

      <div className={`mobile-menu${open ? ' open' : ''}`}>
        <Link href="/" onClick={() => setOpen(false)} className={pathname === '/' ? 'active' : ''}>
          Home
        </Link>
        {LINKS.map(([href, label]) => (
          <Link
            href={href}
            key={href}
            onClick={() => setOpen(false)}
            className={pathname === href ? 'active' : ''}
          >
            {label}
          </Link>
        ))}
        <form action={signOut}>
          <button type="submit">Sign out</button>
        </form>
      </div>
    </header>
  );
}
