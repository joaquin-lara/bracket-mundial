'use client';

import { useSyncExternalStore } from 'react';
import { getPresence, getServerPresence, subscribePresence } from '@/lib/presenceStore';

/** Live status marker: green dot = online, gold ⚔️ = currently in a duel. */
export default function PresenceDot({ userId }: { userId: string }) {
  const presence = useSyncExternalStore(subscribePresence, getPresence, getServerPresence);
  const status = presence.get(userId);
  if (!status) return null;
  return status === 'dueling' ? (
    <span className="pres-duel" title="In a duel">
      ⚔️
    </span>
  ) : (
    <span className="pres-dot" title="Online" />
  );
}
