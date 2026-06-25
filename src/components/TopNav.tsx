'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import TransitionLink from './TransitionLink';
import { signOut } from '@/app/actions';

const BASE_LINKS: readonly (readonly [string, string])[] = [
  ['/rules', 'Rules'],
  ['/schedule', 'Game schedule'],
  ['/matches', 'View your bracket'],
  ['/bracket', 'Tournament Tracker'],
  ['/standings', 'Player Standings'],
  ['/predictor', 'ML Predictor'],
  ['/duels', 'Penalty Shootouts'],
  ['/gamblers', 'Gamblers'],
];

export default function TopNav({
  achievementsRevealed = false,
  isGuest = false,
}: {
  achievementsRevealed?: boolean;
  isGuest?: boolean;
}) {
  const withAchievements: readonly (readonly [string, string])[] = achievementsRevealed
    ? [
        ...BASE_LINKS.slice(0, 5),
        ['/achievements', 'Achievements'],
        ...BASE_LINKS.slice(5),
      ]
    : BASE_LINKS;
  // Guests have no editable profile, so they don't see the Profile tab.
  const LINKS: readonly (readonly [string, string])[] = isGuest
    ? withAchievements
    : [...withAchievements, ['/profile', 'Profile']];
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const touchStart = useRef<{ x: number; y: number; inScrollable: boolean } | null>(null);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  // Swipe right to open; swipe left to close — only fires on mostly-horizontal swipes
  useEffect(() => {
    const isHScrollable = (el: Element | null): boolean => {
      while (el && el !== document.body) {
        const ox = window.getComputedStyle(el).overflowX;
        if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth) return true;
        el = el.parentElement;
      }
      return false;
    };

    const onStart = (e: TouchEvent) => {
      touchStart.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        inScrollable: isHScrollable(e.target as Element),
      };
    };
    const onEnd = (e: TouchEvent) => {
      if (!touchStart.current) return;
      const { x, y, inScrollable } = touchStart.current;
      const dx = e.changedTouches[0].clientX - x;
      const dy = e.changedTouches[0].clientY - y;
      touchStart.current = null;
      if (inScrollable) return; // inside a horizontal scroll container — ignore
      if (Math.abs(dx) < Math.abs(dy) * 1.5) return; // too vertical — ignore
      if (!open && dx > 40) setOpen(true);
      if (open && dx < -60) setOpen(false);
    };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchend', onEnd);
    };
  }, [open]);

  return (
    <>
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
        <span className="brand-badge">
          <img src="/stonks-badge.png" alt="Stonks" className="brand-logo" />
        </span>
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
    </header>

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
    </>
  );
}
