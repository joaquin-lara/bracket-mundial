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

// --- Admins ----------------------------------------------------------------
// The four founders are the admins. New players sign up but stay 'pending'
// until any one admin approves them. This list is the client-side mirror of
// is_admin_email() in supabase/signups.sql; keep them in sync.
export const ADMIN_EMAILS: string[] = PLAYERS.map((p) => playerEmail(p));

/** True if this signed-in user is one of the four founding admins. */
export function isAdminEmail(email: string | null | undefined): boolean {
  return ADMIN_EMAILS.includes((email ?? '').toLowerCase());
}

// --- New-player sign-up -----------------------------------------------------
// Accent colors a new player's avatar/name can use. Kept distinct from the
// founders' colors. The sign-up form assigns one automatically.
export const SIGNUP_COLORS = ['#5fa8e6', '#e67ea3', '#9ad17c', '#d9b35f', '#b07ce8', '#e88a5f'];

/** Pick a stable accent color for a brand-new player from their name. */
export function colorForName(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return SIGNUP_COLORS[h % SIGNUP_COLORS.length];
}

/** Display name format only: 2 to 14 chars, letters/numbers/space, not "Guest". */
export function isValidNameFormat(name: string): boolean {
  const n = name.trim();
  if (n.length < 2 || n.length > 14) return false;
  if (!/^[A-Za-z0-9 ]+$/.test(n)) return false;
  return n.toLowerCase() !== GUEST_NAME.toLowerCase();
}

/** Validate a brand-new sign-up name: valid format and not a reserved slot. */
export function isValidSignupName(name: string): boolean {
  if (!isValidNameFormat(name)) return false;
  // A new sign-up cannot claim a founder's reserved name.
  return !PLAYERS.map((p) => p.toLowerCase()).includes(name.trim().toLowerCase());
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
