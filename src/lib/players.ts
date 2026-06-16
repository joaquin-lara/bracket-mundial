// The fixed roster. Each player gets a hidden Supabase account derived from
// their name; the 4-digit PIN becomes their password. The first PIN a player
// enters claims their slot.
export const PLAYERS = ['Carlos', 'Sebas', 'Mauri', 'Joaquin'] as const;
export type Player = (typeof PLAYERS)[number];

export const PLAYER_META: Record<Player, { initial: string; color: string; flagCode: string }> = {
  Carlos:  { initial: 'C', color: '#e6b337', flagCode: 'NCA' },
  Sebas:   { initial: 'S', color: '#7fc8a9', flagCode: 'GUA' },
  Mauri:   { initial: 'M', color: '#c9a0dc', flagCode: 'HON' },
  Joaquin: { initial: 'J', color: '#e89a7c', flagCode: 'CHI' },
};

export function playerEmail(player: string): string {
  return `${player.toLowerCase()}@bracketmundial.app`;
}

export function pinPassword(player: string, pin: string): string {
  // Supabase requires 6+ char passwords; pad the 4-digit PIN deterministically.
  return `bm-${pin}-${player.toLowerCase()}`;
}

// --- TEMPORARY achievements preview ----------------------------------------
// Lets one account see the achievements page / nav / badges BEFORE the public
// reveal, for review. Set to null (or remove this + its usages in
// layout.tsx, app/achievements/page.tsx, app/standings/page.tsx) to disable.
const ACHIEVEMENTS_PREVIEW_PLAYER: string | null = 'Joaquin';

export function isAchievementsPreviewUser(email: string | null | undefined): boolean {
  if (!ACHIEVEMENTS_PREVIEW_PLAYER) return false;
  return (email ?? '').toLowerCase() === playerEmail(ACHIEVEMENTS_PREVIEW_PLAYER);
}

// A single shared, view-only account for visitors who just want to look
// around. It is a real Supabase user (so row-level security still applies),
// but the app blocks it from editing the bracket or running shootouts.
export const GUEST_NAME = 'Guest';
export const GUEST_EMAIL = 'guest@bracketmundial.app';
export const GUEST_PASSWORD = 'bm-guest-viewer-account';

/** True if this signed-in user is the shared guest account. */
export function isGuestEmail(email: string | null | undefined): boolean {
  return (email ?? '').toLowerCase() === GUEST_EMAIL;
}
