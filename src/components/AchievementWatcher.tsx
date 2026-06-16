'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ACHIEVEMENTS_BY_ID } from '@/lib/achievementsList';
import { createClient } from '@/lib/supabase/client';

function readLocal(key: string): string | null {
  try { return typeof window !== 'undefined' ? window.localStorage.getItem(key) : null; } catch { return null; }
}
function writeLocal(key: string, value: string): void {
  try { if (typeof window !== 'undefined') window.localStorage.setItem(key, value); } catch { /* ignore */ }
}

export default function AchievementWatcher({ me }: { me: string }) {
  const supabase = createClient();
  const router = useRouter();
  const [toast, setToast] = useState<string | null>(null);
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    const seenKey = `ach_seen_${me}`;

    async function init() {
      const { data: existing } = await supabase
        .from('user_achievements')
        .select('achievement_id, baseline')
        .eq('user_id', me);

      const all = existing ?? [];

      // Seed the realtime dedup set so live events don't re-toast.
      all.forEach((r) => seen.current.add(r.achievement_id as string));

      // Compare against what was stored on the last visit. Achievements that
      // are new (not in stored) and not baseline were earned while away —
      // the Realtime INSERT fired before this client connected, so we catch
      // them here instead.
      const storedRaw = readLocal(seenKey);
      if (storedRaw !== null) {
        const stored = new Set(JSON.parse(storedRaw) as string[]);
        const newOnes = all.filter(
          (r) => !(r.baseline as boolean) && !stored.has(r.achievement_id as string)
        );
        if (newOnes.length === 1) {
          const def = ACHIEVEMENTS_BY_ID[newOnes[0].achievement_id as string];
          setToast(`${def?.emoji ?? '🏅'} You unlocked ${def?.name ?? 'an achievement'}!`);
        } else if (newOnes.length > 1) {
          setToast(`🏅 You unlocked ${newOnes.length} new achievements!`);
        }
      }

      // Save current IDs so next visit knows the baseline.
      writeLocal(seenKey, JSON.stringify(all.map((r) => r.achievement_id)));
    }
    init();

    const ch = supabase
      .channel('ach-watch')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'user_achievements' },
        (payload) => {
          const row = payload.new as { user_id: string; achievement_id: string; baseline: boolean };
          if (row.baseline) return;
          if (row.user_id !== me) return;
          if (seen.current.has(row.achievement_id)) return; // init() already toasted
          seen.current.add(row.achievement_id);
          // Keep localStorage in sync so next visit doesn't re-toast.
          const stored: string[] = JSON.parse(readLocal(seenKey) ?? '[]');
          writeLocal(seenKey, JSON.stringify([...stored, row.achievement_id]));
          const def = ACHIEVEMENTS_BY_ID[row.achievement_id];
          setToast(`${def?.emoji ?? '🏅'} You unlocked ${def?.name ?? 'an achievement'}!`);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  if (!toast) return null;

  return (
    <button className="chal-toast" onClick={() => { setToast(null); router.push('/achievements'); }}>
      {toast}
    </button>
  );
}
