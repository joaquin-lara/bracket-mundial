'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

const THRESHOLD = 70; // px of pull needed to trigger a refresh
const MAX_PULL = 110; // cap on how far the indicator travels
const RESISTANCE = 0.5; // drag feels heavier than the finger

/**
 * Mobile pull-to-refresh. When the page is scrolled to the very top and the
 * user drags down, a spinner follows the finger; releasing past the threshold
 * soft-refreshes the current route (re-running the server data fetch) without a
 * full reload, so the user stays on the same tab. Touch-only, so it is inert on
 * desktop.
 */
export default function PullToRefresh() {
  const router = useRouter();
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pending, startTransition] = useTransition();

  const startY = useRef(0);
  const tracking = useRef(false);
  const armed = useRef(false);

  useEffect(() => {
    function onStart(e: TouchEvent) {
      if (refreshing || e.touches.length !== 1 || window.scrollY > 0) return;
      startY.current = e.touches[0].clientY;
      tracking.current = true;
      armed.current = false;
    }

    function onMove(e: TouchEvent) {
      if (!tracking.current || refreshing) return;
      const dy = e.touches[0].clientY - startY.current;
      // Finger moving up, or no longer at the top: this is a normal scroll.
      if (dy <= 0 || window.scrollY > 0) {
        tracking.current = window.scrollY <= 0 && dy <= 0;
        if (pull !== 0) setPull(0);
        if (dragging) setDragging(false);
        return;
      }
      // At the top, pulling down: take over and show the indicator.
      e.preventDefault();
      if (!dragging) setDragging(true);
      const dist = Math.min(dy * RESISTANCE, MAX_PULL);
      setPull(dist);
      armed.current = dist >= THRESHOLD;
    }

    function onEnd() {
      if (!tracking.current) return;
      tracking.current = false;
      setDragging(false);
      if (armed.current && !refreshing) {
        armed.current = false;
        setRefreshing(true);
        setPull(THRESHOLD);
        startTransition(() => router.refresh());
      } else {
        setPull(0);
      }
    }

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [refreshing, dragging, pull, router]);

  // Retract once the server refresh has finished re-rendering.
  useEffect(() => {
    if (refreshing && !pending) {
      const t = setTimeout(() => {
        setRefreshing(false);
        setPull(0);
      }, 350);
      return () => clearTimeout(t);
    }
  }, [refreshing, pending]);

  const visible = pull > 0 || refreshing;
  const progress = Math.min(pull / THRESHOLD, 1);

  return (
    <div
      className="ptr"
      aria-hidden={!visible}
      style={{
        transform: `translateX(-50%) translateY(${visible ? pull : 0}px)`,
        opacity: visible ? 1 : 0,
        transition: dragging ? 'none' : 'transform 0.25s ease, opacity 0.2s ease',
      }}
    >
      <span
        className={`ptr-spinner${refreshing ? ' spin' : ''}`}
        style={refreshing ? undefined : { transform: `rotate(${progress * 270}deg)` }}
      />
    </div>
  );
}
