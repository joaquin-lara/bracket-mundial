'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LOCK_MS } from '@/lib/types';
import { createClient } from '@/lib/supabase/client';

/**
 * After the home intro settles, reminds the player once per browser session
 * if they have games today that are still open (>10 min to kickoff) and
 * unpicked. Uses the shared alert-modal style. No push, no permissions.
 */
export default function PickReminder({ me, isGuest }: { me: string; isGuest: boolean }) {
  const supabase = createClient();
  const router = useRouter();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (isGuest) return; // guests don't predict
    if (sessionStorage.getItem('pickReminderShown')) return;

    const t = setTimeout(async () => {
      const now = Date.now();
      const from = new Date(now).toISOString();
      const to = new Date(now + 24 * 3600_000).toISOString();

      // today's still-open fixtures (real teams, lock window not closed)
      const { data: matches } = await supabase
        .from('matches')
        .select('id, kickoff, home_team, away_team')
        .gte('kickoff', from)
        .lte('kickoff', to);

      const localToday = new Date().toLocaleDateString('en-CA');
      const open = (matches ?? []).filter(
        (m) =>
          m.home_team !== 'TBD' &&
          m.away_team !== 'TBD' &&
          new Date(m.kickoff as string).toLocaleDateString('en-CA') === localToday &&
          new Date(m.kickoff as string).getTime() - now > LOCK_MS
      );
      if (open.length === 0) return;

      const ids = open.map((m) => m.id);
      const { data: preds } = await supabase
        .from('predictions')
        .select('match_id')
        .eq('user_id', me)
        .in('match_id', ids);
      const picked = new Set((preds ?? []).map((p) => p.match_id));
      const missing = ids.filter((id) => !picked.has(id)).length;

      sessionStorage.setItem('pickReminderShown', '1');
      if (missing > 0) setCount(missing);
    }, 3600); // let the home intro finish first

    return () => clearTimeout(t);
  }, [me, isGuest, supabase]);

  if (count === 0) return null;

  return (
    <div className="chal-backdrop">
      <div className="chal-modal">
        <div className="chal-icon">⚽</div>
        <div className="chal-title">
          {count} unpicked game{count === 1 ? '' : 's'} today
        </div>
        <div className="chal-sub">Lock in your scores before kickoff</div>
        <div className="chal-actions">
          <button
            className="save-btn"
            onClick={() => {
              setCount(0);
              router.push('/matches');
            }}
          >
            Fill them in
          </button>
          <button className="chal-decline" onClick={() => setCount(0)}>
            Later
          </button>
        </div>
      </div>
    </div>
  );
}
