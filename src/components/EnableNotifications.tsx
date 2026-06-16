'use client';

import { useEffect, useState } from 'react';

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

type State = 'hidden' | 'iosInstall' | 'prompt' | 'busy' | 'denied' | 'on';

/**
 * Discreet pill that turns on Web Push: registers the service worker, requests
 * permission, subscribes via the VAPID key, and stores the subscription. On iOS
 * it first nudges the user to add the app to the home screen (push only works in
 * the installed PWA there). Renders nothing once alerts are on, or if the browser
 * can't do push, or after the user dismisses it.
 */
export default function EnableNotifications() {
  const [state, setState] = useState<State>('hidden');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!VAPID) return; // feature not configured
    if (typeof window === 'undefined') return;

    const dismissed = localStorage.getItem('pushCtaDismissed') === '1';
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

    if (supported && Notification.permission === 'granted') {
      // Already granted: make sure the SERVER actually has this subscription.
      // An earlier save may have failed (e.g. before the DB table existed), and
      // the app would otherwise never retry. Re-save on every load (idempotent).
      navigator.serviceWorker.register('/sw.js').catch(() => {});
      navigator.serviceWorker.ready
        .then((reg) => reg.pushManager.getSubscription())
        .then((sub) => {
          if (sub) {
            fetch('/api/push/subscribe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(sub),
            }).catch(() => {});
            setState('on');
          } else if (!dismissed) {
            setState('prompt');
          }
        });
      return;
    }

    if (dismissed) return; // remaining states are just the prompt pill
    if (isIOS && !standalone) {
      setState('iosInstall');
      return;
    }
    if (!supported) return;
    setState(Notification.permission === 'denied' ? 'denied' : 'prompt');
  }, []);

  async function enable() {
    setState('busy');
    setErr(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setState(perm === 'denied' ? 'denied' : 'prompt');
        return;
      }
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID!) as BufferSource,
        });
      }
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `Save failed (${res.status})`);
      }
      setState('hidden');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong');
      setState('prompt');
    }
  }

  async function sendTest() {
    setErr('Sending test…');
    try {
      const res = await fetch('/api/push/debug', { method: 'POST' });
      const j = (await res.json()) as { sent?: number; devices?: number; errors?: string[] };
      setErr(
        (j.sent ?? 0) > 0
          ? `Sent to ${j.sent} device(s) ✓`
          : (j.devices ?? 0) === 0
            ? 'No devices saved for this account'
            : `Failed: ${(j.errors || []).join('; ') || res.status}`
      );
    } catch {
      setErr('Request failed');
    }
  }

  function dismiss() {
    localStorage.setItem('pushCtaDismissed', '1');
    setState('hidden');
  }

  if (state === 'hidden') return null;

  const wrap: React.CSSProperties = {
    position: 'fixed', left: '50%', bottom: 16, transform: 'translateX(-50%)', zIndex: 9999,
    display: 'flex', alignItems: 'center', gap: 10, maxWidth: 'calc(100vw - 24px)',
    background: '#0b5f3a', color: '#fff', padding: '10px 14px', borderRadius: 999,
    boxShadow: '0 6px 24px rgba(0,0,0,.35)', font: '14px system-ui, sans-serif',
  };
  const btn: React.CSSProperties = {
    background: '#fff', color: '#0b5f3a', border: 0, borderRadius: 999,
    padding: '6px 12px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
  };
  const x: React.CSSProperties = { background: 'transparent', color: '#cfe8db', border: 0, cursor: 'pointer', fontSize: 16, lineHeight: 1 };

  if (state === 'on') {
    return (
      <div style={wrap}>
        <span>🔔 {err ?? 'Notifications on'}</span>
        <button style={btn} onClick={sendTest}>Send test</button>
        <button style={x} onClick={dismiss} aria-label="Dismiss">×</button>
      </div>
    );
  }

  if (state === 'iosInstall') {
    return (
      <div style={wrap}>
        <span>📲 Add Stonks to your Home Screen (Share → Add to Home Screen) to get match alerts.</span>
        <button style={x} onClick={dismiss} aria-label="Dismiss">×</button>
      </div>
    );
  }
  if (state === 'denied') {
    return (
      <div style={wrap}>
        <span>🔕 Notifications are blocked. Enable them for Stonks in your phone&apos;s Settings.</span>
        <button style={x} onClick={dismiss} aria-label="Dismiss">×</button>
      </div>
    );
  }
  return (
    <div style={wrap}>
      <span>🔔 {err ?? 'Get alerts for kickoffs & goals?'}</span>
      <button style={btn} onClick={enable} disabled={state === 'busy'}>
        {state === 'busy' ? '…' : 'Enable'}
      </button>
      <button style={x} onClick={dismiss} aria-label="Dismiss">×</button>
    </div>
  );
}
