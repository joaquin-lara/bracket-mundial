// The fixed roster. Each player gets a hidden Supabase account derived from
// their name; the 4-digit PIN becomes their password. The first PIN a player
// enters claims their slot.
export const PLAYERS = ['Carlos', 'Sebas', 'Mauri', 'Joaquin'] as const;
export type Player = (typeof PLAYERS)[number];

export const PLAYER_META: Record<Player, { initial: string; color: string }> = {
  Carlos: { initial: 'C', color: '#e6b337' },
  Sebas: { initial: 'S', color: '#7fc8a9' },
  Mauri: { initial: 'M', color: '#c9a0dc' },
  Joaquin: { initial: 'J', color: '#e89a7c' },
};

export function playerEmail(player: string): string {
  return `${player.toLowerCase()}@bracketmundial.app`;
}

export function pinPassword(player: string, pin: string): string {
  // Supabase requires 6+ char passwords; pad the 4-digit PIN deterministically.
  return `bm-${pin}-${player.toLowerCase()}`;
}
