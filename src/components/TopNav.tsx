'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { signOut } from '@/app/actions';
import TransitionLink from './TransitionLink';

const LINKS = [
  ['/matches', 'Edit your bracket'],
  ['/bracket', 'Group and Bracket Tracker'],
  ['/schedule', 'Game schedule'],
  ['/standings', 'Player Standings'],
  ['/predictor', 'ML Predictor'],
  ['/duels', 'Penalty Shootouts'],
  ['/rules', 'Rules'],
] as const;

export default function TopNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

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

      <TransitionLink href="/" className="brand" onClick={() => setOpen(false)}>
        <span className="brand-badge">⚽</span>
        <span className="brand-name">Stonks©</span>
      </TransitionLink>

      <nav className="topnav desktop-nav">
        <TransitionLink href="/" className={pathname === '/' ? 'active' : ''}>
          Home
        </TransitionLink>
        {LINKS.map(([href, label]) => (
          <TransitionLink href={href} key={href} className={pathname === href ? 'active' : ''}>
            {label}
          </TransitionLink>
        ))}
        <form action={signOut}>
          <button type="submit">Sign out</button>
        </form>
      </nav>

      <span className="burger-spacer" />

      <div className={`mobile-menu${open ? ' open' : ''}`}>
        <TransitionLink href="/" onClick={() => setOpen(false)} className={pathname === '/' ? 'active' : ''}>
          Home
        </TransitionLink>
        {LINKS.map(([href, label]) => (
          <TransitionLink
            href={href}
            key={href}
            onClick={() => setOpen(false)}
            className={pathname === href ? 'active' : ''}
          >
            {label}
          </TransitionLink>
        ))}
        <form action={signOut}>
          <button type="submit">Sign out</button>
        </form>
      </div>
    </header>
  );
}
