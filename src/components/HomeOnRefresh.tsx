'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** On a browser refresh (F5), land back on the home tab. */
export default function HomeOnRefresh() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const nav = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined;
    if (nav?.type === 'reload' && pathname !== '/' && pathname !== '/login') {
      router.replace('/');
    }
    // Run once per full page load only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
