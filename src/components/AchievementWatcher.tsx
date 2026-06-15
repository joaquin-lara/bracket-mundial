'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ACHIEVEMENTS_BY_ID } from '@/lib/achievementsList';
import { createClient } from '@/lib/supabase/client';

const REVEAL_KEY = 'ach_reveal_seen';

/**
 * Site-wide achievement notifications, mounted in the root layout.
 *   * The first live unlock ever fires a center-screen reveal banner ("New
 *     feature! X earned ...") — shown once per device via localStorage.
 *   * Every later unlock pops a toast.
 * Picks stay server-side; this only reacts to the public user_achievements
 * and achievements_state tables.
 */
export default function AchievementWatcher() {
  const supabase = createClient();
  const router = useRouter();
  const [banner, setBanner] = useState<{ who: string; name: string; emoji: string; at: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const names = useRef<Map<string, string>>(new Map());
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    let active = true;

    async function init() {
      const { data: profs } = await supabase.from('profiles').select('id, display_name');
      profs?.forEach((p) => names.current.set(p.id as string, p.display_name as string));

      // Seed seen-set so historical unlocks don't toast on every page load.
      const { data: existing } = await supabase
        .from('user_achievements')
        .select('user_id, achievement_id');
      existing?.forEach((r) => seen.current.add(`${r.user_id}|${r.achievement_id}`));

      const { data: st } = await supabase
        .from('achievements_state')
        .select('revealed_at, first_user, first_achievement')
        .eq('id', 1)
        .maybeSingle();
      if (active && st?.revealed_at && readLocal(REVEAL_KEY) !== st.revealed_at) {
        showBanner(st.first_user as string | null, st.first_achievement as string | null, st.revealed_at as string);
      }
    }
    init();

    const ch = supabase
      .channel('ach-watch')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'user_achievements' },
        (payload) => {
          const row = payload.new as { user_id: string; achievement_id: string; baseline: boolean };
          if (row.baseline) return; // silent launch backfill
          const key = `${row.user_id}|${row.achievement_id}`;
          if (seen.current.has(key)) return;
          seen.current.add(key);
          const def = ACHIEVEMENTS_BY_ID[row.achievement_id];
          const who = names.current.get(row.user_id) ?? 'Someone';
          setToast(`${def?.emoji ?? '🏅'} ${who} unlocked ${def?.name ?? 'an achievement'}!`);
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'achievements_state' },
        (payload) => {
          const row = payload.new as {
            revealed_at: string | null;
            first_user: string | null;
            first_achievement: string | null;
          };
          if (!row.revealed_at || readLocal(REVEAL_KEY) === row.revealed_at) return;
          showBanner(row.first_user, row.first_achievement, row.revealed_at);
        }
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  function showBanner(userId: string | null, achId: string | null, at: string) {
    const def = achId ? ACHIEVEMENTS_BY_ID[achId] : undefined;
    setBanner({
      who: names.current.get(userId ?? '') ?? 'Someone',
      name: def?.name ?? 'an achievement',
      emoji: def?.emoji ?? '🏅',
      at,
    });
  }

  function dismissBanner(goToPage: boolean) {
    if (banner) writeLocal(REVEAL_KEY, banner.at);
    setBanner(null);
    if (goToPage) router.push('/achievements');
  }

  return (
    <>
      {banner && (
        <div className="chal-backdrop">
          <div className="chal-modal">
            <div className="chal-icon">{banner.emoji}</div>
            <div className="chal-title">
              {banner.who} unlocked {banner.name}!
            </div>
            <div className="chal-sub">New feature · achievements are now live for everyone</div>
            <p style={{ margin: '0 0 18px', fontSize: 14, color: 'var(--muted)' }}>
              The first badge has been earned. Go see what everyone&apos;s got.
            </p>
            <div className="chal-actions">
              <button className="save-btn" onClick={() => dismissBanner(true)}>
                See achievements
              </button>
              <button className="chal-decline" onClick={() => dismissBanner(false)}>
                Later
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <button className="chal-toast" onClick={() => { setToast(null); router.push('/achievements'); }}>
          {toast}
        </button>
      )}
    </>
  );
}

function readLocal(key: string): string | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}
function writeLocal(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}
