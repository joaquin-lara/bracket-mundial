'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes — matches the server-side score sync throttle

/** Silently re-runs server data fetches every 5 minutes so scores update without a manual reload. */
export default function AutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), INTERVAL_MS);
    return () => clearInterval(id);
  }, [router]);

  return null;
}
