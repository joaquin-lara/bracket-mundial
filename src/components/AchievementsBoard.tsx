'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ACHIEVEMENTS,
  CATEGORY_ORDER,
  PLATINUM_ID,
  PLATINUM_REQUIRED_IDS,
  TIER_LABEL,
  TIER_ORDER,
  type Tier,
} from '@/lib/achievementsList';
import { PLAYER_META } from '@/lib/players';

export interface BoardEarner {
  userId: string;
  name: string;
  /** "ESP 2–1 ARG · Jun 14" for match-based badges, else just the date. */
  detail: string;
  earnedAt: string; // ISO timestamp for sorting
}
export interface BoardPlayer {
  userId: string;
  name: string;
}
interface Props {
  earners: Record<string, BoardEarner[]>;
  players: BoardPlayer[];
  meId: string;
}

const RARITY_DISPLAY: Tier[] = ['common', 'rare', 'epic', 'legendary', 'platinum'];
const TIERS: Tier[] = ['common', 'rare', 'epic', 'legendary', 'platinum'];
const TOTAL = ACHIEVEMENTS.length;

const META = PLAYER_META as Record<string, { initial: string; color: string; flagCode: string }>;
function metaFor(name: string) {
  return META[name] ?? { initial: name.slice(0, 1).toUpperCase(), color: '#9aa5a0', flagCode: '' };
}

type GroupMode = 'rarity' | 'category';
type FilterMode = 'all' | 'unlocked' | 'locked' | 'recent';

const FILTER_OPTIONS: { value: FilterMode; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unlocked', label: 'Unlocked' },
  { value: 'locked', label: 'Locked' },
  { value: 'recent', label: 'Recent' },
];

function FilterDropdown({ value, onChange }: { value: FilterMode; onChange: (v: FilterMode) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close when clicking outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const current = FILTER_OPTIONS.find((o) => o.value === value)!;

  return (
    <div className="ach-filter-drop" ref={ref}>
      <button className={`ach-filter-trigger${value === 'all' ? ' wide' : ''}`} onClick={() => setOpen((o) => !o)}>
        {current.label}
        <span className="ach-filter-caret">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="ach-filter-menu">
          {FILTER_OPTIONS.map((o) => (
            <button
              key={o.value}
              className={`ach-filter-opt${o.value === value ? ' on' : ''}`}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AchievementsBoard({ earners, players, meId }: Props) {
  const [lens, setLens] = useState(meId);
  const [group, setGroup] = useState<GroupMode>('rarity');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // userId -> set of earned achievement ids
  const earnedByUser = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const [achId, list] of Object.entries(earners)) {
      for (const e of list) {
        if (!m.has(e.userId)) m.set(e.userId, new Set());
        m.get(e.userId)!.add(achId);
      }
    }
    return m;
  }, [earners]);

  const lensSet = earnedByUser.get(lens) ?? new Set<string>();
  const lensName = players.find((p) => p.userId === lens)?.name ?? 'Player';

  // per-rarity counts for the lens player
  const rarityCounts = useMemo(() => {
    const out: Record<Tier, { got: number; total: number }> = {
      common: { got: 0, total: 0 },
      rare: { got: 0, total: 0 },
      epic: { got: 0, total: 0 },
      legendary: { got: 0, total: 0 },
      platinum: { got: 0, total: 0 },
    };
    for (const a of ACHIEVEMENTS) {
      out[a.tier].total += 1;
      if (lensSet.has(a.id)) out[a.tier].got += 1;
    }
    return out;
  }, [lensSet]);

  const lensTotal = lensSet.size;

  // For "recently obtained": unlocked achievements sorted newest-first
  const recentItems = useMemo(() => {
    return ACHIEVEMENTS
      .filter((a) => lensSet.has(a.id))
      .map((a) => {
        const earnedAt = earners[a.id]?.find((e) => e.userId === lens)?.earnedAt ?? '';
        return { a, earnedAt };
      })
      .sort((x, y) => y.earnedAt.localeCompare(x.earnedAt))
      .map(({ a }) => a);
  }, [earners, lens, lensSet]);

  const groups = useMemo(() => {
    const items = ACHIEVEMENTS.filter((a) => {
      if (filter === 'unlocked') return lensSet.has(a.id);
      if (filter === 'locked') return !lensSet.has(a.id);
      if (filter === 'recent') return lensSet.has(a.id);
      return true;
    });
    const sortItems = (arr: typeof ACHIEVEMENTS) =>
      arr.slice().sort((a, b) => {
        const ua = lensSet.has(a.id) ? 0 : 1;
        const ub = lensSet.has(b.id) ? 0 : 1;
        if (ua !== ub) return ua - ub; // unlocked first
        const t = TIER_ORDER[a.tier] - TIER_ORDER[b.tier]; // common first
        if (t !== 0) return t;
        return a.name.localeCompare(b.name);
      });

    if (group === 'rarity') {
      return RARITY_DISPLAY.map((t) => ({
        key: TIER_LABEL[t],
        tier: t as Tier | null,
        items: sortItems(items.filter((a) => a.tier === t)),
      })).filter((g) => g.items.length > 0);
    }
    return CATEGORY_ORDER.map((c) => ({
      key: c as string,
      tier: null as Tier | null,
      items: sortItems(items.filter((a) => a.category === c)),
    })).filter((g) => g.items.length > 0);
  }, [filter, group, lensSet]);

  return (
    <div className="ach-board">
      {/* whose lens */}
      <div className="ach-players">
        {players.map((p) => {
          const count = earnedByUser.get(p.userId)?.size ?? 0;
          const m = metaFor(p.name);
          return (
            <button
              key={p.userId}
              className={`ach-player-pill${p.userId === lens ? ' active' : ''}`}
              onClick={() => setLens(p.userId)}
            >
              <span className="ach-dot" style={{ background: m.color }}>{m.initial}</span>
              <span className="ach-pp-name">
                {p.name}
                {p.userId === meId ? ' (you)' : ''}
              </span>
              <span className="ach-pp-count">{count}</span>
            </button>
          );
        })}
      </div>

      {/* lens summary */}
      <div className="ach-summary">
        <div className="ach-sum-top">
          <strong>{lensName}</strong> · {lensTotal} / {TOTAL} unlocked
        </div>
        <div className="ach-progress">
          {TIERS.map((t) =>
            rarityCounts[t].got > 0 ? (
              <div
                key={t}
                className={`ach-progress-seg tier-pill-${t}`}
                style={{ width: `${(rarityCounts[t].got / TOTAL) * 100}%` }}
                title={`${TIER_LABEL[t]}: ${rarityCounts[t].got}`}
              />
            ) : null
          )}
        </div>
        <div className="ach-rarity-chips">
          {TIERS.map((t) => (
            <span key={t} className={`ach-rchip tier-pill-${t}`}>
              {TIER_LABEL[t]} {rarityCounts[t].got}/{rarityCounts[t].total}
            </span>
          ))}
        </div>
      </div>

      {/* controls */}
      <div className="ach-controls">
        <div className="ach-seg">
          <button className={group === 'rarity' ? 'on' : ''} onClick={() => setGroup('rarity')}>
            By rarity
          </button>
          <button className={group === 'category' ? 'on' : ''} onClick={() => setGroup('category')}>
            By type
          </button>
        </div>
        <div className="ach-seg ach-seg-filter-buttons">
          <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
            All
          </button>
          <button className={filter === 'unlocked' ? 'on' : ''} onClick={() => setFilter('unlocked')}>
            Unlocked
          </button>
          <button className={filter === 'locked' ? 'on' : ''} onClick={() => setFilter('locked')}>
            Locked
          </button>
          <button className={filter === 'recent' ? 'on' : ''} onClick={() => setFilter('recent')}>
            Recent
          </button>
        </div>
        <div className="ach-filter-drop-wrap">
          <span className="ach-filter-label">Filter by:</span>
          <FilterDropdown value={filter} onChange={setFilter} />
        </div>
      </div>

      {/* sections */}
      {filter === 'recent' ? (
        recentItems.length === 0 ? (
          <p className="empty">{lensName} hasn&apos;t unlocked anything yet.</p>
        ) : (
          <section className="ach-section">
            <div className="ach-grid">
              {recentItems.map((a) => {
                const got4 = earners[a.id] ?? [];
                const expanded = expandedId === a.id;
                const earnedDetail = got4.find((e) => e.userId === lens)?.detail ?? '';
                return (
                  <div
                    key={a.id}
                    className={`ach-card tier-${a.tier} unlocked${expanded ? ' expanded' : ''}`}
                    onClick={() => setExpandedId((cur) => (cur === a.id ? null : a.id))}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="ach-card-main">
                      <div className="ach-emoji">{a.emoji}</div>
                      <div className="ach-body">
                        <div className="ach-name">
                          {a.name}
                          <span className={`ach-tier tier-pill-${a.tier}`}>{TIER_LABEL[a.tier]}</span>
                        </div>
                        <div className="ach-desc">{a.description}</div>
                        <div className="ach-desc" style={{ opacity: 0.6, fontSize: 12 }}>{earnedDetail}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )
      ) : groups.length === 0 ? (
        <p className="empty">Nothing here for {lensName} yet.</p>
      ) : (
        groups.map((g) => {
          const got = g.items.filter((a) => lensSet.has(a.id)).length;
          return (
            <section key={g.key} className="ach-section">
              <h2 className="ach-cat">
                {g.tier ? <span className={`ach-rdot tier-pill-${g.tier}`} /> : null}
                {g.key}
                <span className="ach-cat-count">
                  {got}/{g.items.length}
                </span>
              </h2>
              <div className="ach-grid">
                {g.items.map((a) => {
                  const got4 = earners[a.id] ?? [];
                  const unlockedForLens = lensSet.has(a.id);
                  const expanded = expandedId === a.id;
                  return (
                    <div
                      key={a.id}
                      className={`ach-card tier-${a.tier}${unlockedForLens ? ' unlocked' : ' locked'}${expanded ? ' expanded' : ''}`}
                      onClick={() => setExpandedId((cur) => (cur === a.id ? null : a.id))}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="ach-card-main">
                        <div className="ach-emoji">{a.emoji}</div>
                        <div className="ach-body">
                          <div className="ach-name">
                            {a.name}
                            <span className={`ach-tier tier-pill-${a.tier}`}>{TIER_LABEL[a.tier]}</span>
                          </div>
                          <div className="ach-desc">{a.description}</div>
                          <div className="ach-edots">
                            {players.map((p) => {
                              const has = earnedByUser.get(p.userId)?.has(a.id);
                              const m = metaFor(p.name);
                              return (
                                <span
                                  key={p.userId}
                                  className={`ach-edot${has ? ' has' : ''}${p.userId === lens ? ' lens' : ''}`}
                                  style={has ? { background: m.color, color: '#0b3d2c' } : undefined}
                                >
                                  {m.initial}
                                </span>
                              );
                            })}
                            <span className="ach-expand-hint">{expanded ? '▴' : '▾'}</span>
                          </div>
                        </div>
                      </div>
                      {expanded && a.id === PLATINUM_ID && (
                        <div className="ach-detail">
                          <div className="ach-detail-head">Badges still needed (of {PLATINUM_REQUIRED_IDS.length})</div>
                          {players.map((p) => {
                            const set = earnedByUser.get(p.userId) ?? new Set<string>();
                            const missing = PLATINUM_REQUIRED_IDS.filter((id) => !set.has(id)).length;
                            const m = metaFor(p.name);
                            return (
                              <div key={p.userId} className="ach-detail-row">
                                <span className="ach-edot has" style={{ background: m.color, color: '#0b3d2c' }}>
                                  {m.initial}
                                </span>
                                <span className="ach-detail-name">{p.name}</span>
                                <span className={`ach-detail-when${missing === 0 ? '' : ' locked'}`}>
                                  {missing === 0 ? 'Complete ✓' : `${missing} to go`}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {expanded && a.id !== PLATINUM_ID && (
                        <div className="ach-detail">
                          {players.map((p) => {
                            const e = got4.find((x) => x.userId === p.userId);
                            const m = metaFor(p.name);
                            return (
                              <div key={p.userId} className="ach-detail-row">
                                <span
                                  className="ach-edot has"
                                  style={{ background: m.color, color: '#0b3d2c', opacity: e ? 1 : 0.35 }}
                                >
                                  {m.initial}
                                </span>
                                <span className="ach-detail-name">{p.name}</span>
                                <span className={`ach-detail-when${e ? '' : ' locked'}`}>
                                  {e ? e.detail : 'Locked'}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
