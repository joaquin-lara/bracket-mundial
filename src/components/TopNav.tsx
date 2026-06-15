'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { signOut } from '@/app/actions';
import TransitionLink from './TransitionLink';

const LINKS = [
  ['/rules', 'Rules'],
  ['/schedule', 'Game schedule'],
  ['/matches', 'View/edit your bracket'],
  ['/standings', 'Player Standings'],
  ['/bracket', 'Group and Bracket Tracker'],
  ['/predictor', 'ML Predictor'],
  ['/duels', 'Penalty Shootouts'],
] as const;

export default function TopNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Swipe from left edge to open; swipe left anywhere to close
  useEffect(() => {
    const onStart = (e: TouchEvent) => {
      touchStartX.current = e.touches[0].clientX;
    };
    const onEnd = (e: TouchEvent) => {
      if (touchStartX.current === null) return;
      const dx = e.changedTouches[0].clientX - touchStartX.current;
      if (!open && touchStartX.current < 20 && dx > 60) setOpen(true);
      if (open && dx < -60) setOpen(false);
      touchStartX.current = null;
    };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchend', onEnd);
    };
  }, [open]);

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

      <div
        className={`mobile-menu-backdrop${open ? ' open' : ''}`}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

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
