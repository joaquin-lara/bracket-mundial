'use client';

import { useEffect } from 'react';

const BASE = 'width=device-width, initial-scale=1';
const LOCKED = `${BASE}, maximum-scale=1, user-scalable=no`;
const BREAKPOINT = 500;

/**
 * Disables pinch-zoom on narrow (mobile) viewports under 500px, while leaving
 * zoom available on wider screens. Swaps the viewport meta on resize.
 */
export default function ViewportLock() {
  useEffect(() => {
    let meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'viewport';
      document.head.appendChild(meta);
    }

    const apply = () => {
      const locked = window.innerWidth < BREAKPOINT;
      const next = locked ? LOCKED : BASE;
      if (meta!.content !== next) meta!.content = next;
    };

    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, []);

  return null;
}
