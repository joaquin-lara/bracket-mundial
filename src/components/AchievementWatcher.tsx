'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ACHIEVEMENTS_BY_ID } from '@/lib/achievementsList';
import { createClient } from '@/lib/supabase/client';

export default function AchievementWatcher({ me }: { me: string }) {
  const supabase = createClient();
  const router = useRouter();
  const [toast, setToast] = useState<string | null>(null);
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    async function init() {
      // Seed seen-set so historical unlocks don't toast on every page load.
      const { data: existing } = await supabase
        .from('user_achievements')
        .select('user_id, achievement_id');
      existing?.forEach((r) => seen.current.add(`${r.user_id}|${r.achievement_id}`));
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
          const key = `${row.user_id}|${row.achievement_id}`;
          if (seen.current.has(key)) return;
          seen.current.add(key);
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
