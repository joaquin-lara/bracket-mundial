// Pure helpers that turn lineup data into normalised pitch coordinates, shared by
// the confirmed-lineup (API-Football) and projected-lineup (fbref) views.

export interface PitchPlayer {
  label: string;
  nx: number; // 0..1 left -> right
  ny: number; // 0 = own goal / GK line, 1 = attack
  gk: boolean;
}

interface XIPlayer { name: string; pos: string; grid: string | null }

function lastName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(' ') : name;
}

/** Surname labels, prefixed with a first initial when two starters share one. */
export function shortLabels(names: string[]): string[] {
  const surnames = names.map(lastName);
  const counts = new Map<string, number>();
  for (const s of surnames) counts.set(s, (counts.get(s) ?? 0) + 1);
  return names.map((name, i) => {
    const sur = surnames[i];
    if ((counts.get(sur) ?? 0) <= 1) return sur;
    return `${name.trim()[0]}. ${sur}`;
  });
}

/** Layout from a formation string + XI listed in order (fbref projection). */
export function fromFormation(formation: string, names: string[]): PitchPlayer[] {
  const lines = formation.split('-').map(Number).filter((k) => k > 0);
  const rows = [1, ...lines];
  const R = rows.length;
  const labels = shortLabels(names);
  const players: PitchPlayer[] = [];
  let idx = 0;
  rows.forEach((k, r) => {
    const ny = R > 1 ? r / (R - 1) : 0;
    for (let i = 0; i < k; i++) {
      players.push({ label: labels[idx] ?? '', nx: (i + 1) / (k + 1), ny, gk: r === 0 });
      idx++;
    }
  });
  return players;
}

const POS_ORDER: Record<string, number> = { G: 0, D: 1, M: 2, F: 3 };

/**
 * Layout from a confirmed XI. Uses API-Football's "row:col" grid when present
 * (row 1 = goalkeeper end) for accurate positions; otherwise falls back to
 * grouping by position (G/D/M/F).
 */
export function fromConfirmed(startXI: XIPlayer[]): PitchPlayer[] {
  const labels = shortLabels(startXI.map((p) => p.name));
  const haveGrid = startXI.every((p) => p.grid && /^\d+:\d+$/.test(p.grid));

  if (haveGrid) {
    const parsed = startXI.map((p, i) => {
      const [row, col] = p.grid!.split(':').map(Number);
      return { row, col, label: labels[i] };
    });
    const maxRow = Math.max(...parsed.map((p) => p.row));
    const widthByRow = new Map<number, number>();
    for (const p of parsed) widthByRow.set(p.row, Math.max(widthByRow.get(p.row) ?? 0, p.col));
    return parsed.map((p) => ({
      label: p.label,
      nx: p.col / ((widthByRow.get(p.row) ?? 1) + 1),
      ny: maxRow > 1 ? (p.row - 1) / (maxRow - 1) : 0,
      gk: p.row === 1,
    }));
  }

  // Fallback: order by position into rows.
  const byRow: Record<number, number[]> = { 0: [], 1: [], 2: [], 3: [] };
  startXI.forEach((p, i) => byRow[POS_ORDER[p.pos] ?? 2].push(i));
  const rows = [0, 1, 2, 3].filter((o) => byRow[o].length > 0);
  const R = rows.length;
  const players: PitchPlayer[] = [];
  rows.forEach((o, r) => {
    const ids = byRow[o];
    const ny = R > 1 ? r / (R - 1) : 0;
    ids.forEach((id, i) => players.push({ label: labels[id], nx: (i + 1) / (ids.length + 1), ny, gk: o === 0 }));
  });
  return players;
}
