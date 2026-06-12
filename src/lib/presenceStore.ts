// Tiny shared store for who's online right now. ChallengeWatcher (mounted on
// every page) feeds it from a Supabase Presence channel; any client component
// can subscribe via usePresence().

export type PresenceStatus = 'online' | 'dueling';

let state = new Map<string, PresenceStatus>();
const listeners = new Set<() => void>();

export function setPresence(next: Map<string, PresenceStatus>) {
  state = next;
  listeners.forEach((l) => l());
}

export function getPresence(): Map<string, PresenceStatus> {
  return state;
}

const EMPTY = new Map<string, PresenceStatus>();
export function getServerPresence(): Map<string, PresenceStatus> {
  return EMPTY;
}

export function subscribePresence(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
