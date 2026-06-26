'use client';

import gsap from 'gsap';
import { useEffect } from 'react';
import { introDecision } from '@/lib/introGate';

// Must match GlobeBackdrop timeline: delay(0.15) + drop(1.1) + spin(2.0)
const GLOBE_END = 3.25;

export default function HomeIntro() {
  useEffect(() => {
    // setTimeout(0) ensures portal elements (PitchStripes) have mounted before querying.
    const t = setTimeout(() => {  // 100ms ensures portal elements have mounted
      const topbar = document.querySelector<HTMLElement>('.topbar');
      const stripes = document.querySelector<HTMLElement>('.pitch-stripes');
      const heroContent = document.querySelector<HTMLElement>('.hero-content');
      const todayGames = document.querySelector<HTMLElement>('.today-games');
      const liveOdds = document.querySelector<HTMLElement>('.live-odds');
      const contenders = document.querySelector<HTMLElement>('.contenders');

      // Revisiting the home tab: no show, just make everything visible.
      const signoutFooter = document.querySelector<HTMLElement>('.signout-footer');

      if (!introDecision()) {
        if (topbar) gsap.set(topbar, { y: 0, opacity: 1 });
        gsap.set([stripes, heroContent, todayGames, liveOdds, contenders, signoutFooter].filter(Boolean), { opacity: 1 });
        // No intro this visit: chat bubble (and anything else waiting) can show now.
        window.dispatchEvent(new Event('bm-intro-done'));
        return;
      }

      // CSS already hides opacity; set the starting Y for the topbar slide.
      if (topbar) gsap.set(topbar, { y: -80 });

      // Tell the chat bubble to fade in once every home icon has popped in.
      const tl = gsap.timeline({ onComplete: () => window.dispatchEvent(new Event('bm-intro-done')) });

      tl.to(stripes,        { opacity: 1, duration: 0.8, ease: 'power2.out' },  GLOBE_END - 0.2)
        .to(topbar,         { y: 0, opacity: 1, duration: 0.6, ease: 'power3.out' }, '<+0.6')
        .to(heroContent,    { opacity: 1, duration: 0.5, ease: 'power2.out' },   '<+0.2')
        .to(todayGames,     { opacity: 1, duration: 0.5, ease: 'power2.out' },   '<+0.2')
        .to(liveOdds,       { opacity: 1, duration: 0.5, ease: 'power2.out' },   '<+0.2')
        .to(contenders,     { opacity: 1, duration: 0.5, ease: 'power2.out' },   '<+0.2')
        .to(signoutFooter,  { opacity: 1, duration: 0.4, ease: 'power2.out' },   '<+0.3');
    }, 100);

    return () => clearTimeout(t);
  }, []);

  // Marker div: CSS :has(.home-intro) hides page elements from the initial server render.
  return <div className="home-intro" hidden aria-hidden="true" />;
}
