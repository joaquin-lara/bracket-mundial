'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { setPresence, type PresenceStatus } from '@/lib/presenceStore';
import { createClient } from '@/lib/supabase/client';

interface DuelLite {
  id: string;
  challenger: string;
  opponent: string;
  status: string;
  canceled_by: string | null;
}

/**
 * Site-wide duel notifications. Mounted in the root layout so a challenge
 * pops as a center-screen alert on ANY page, and the challenger gets told
 * the moment it's accepted or declined.
 */
export default function ChallengeWatcher({ me }: { me: string }) {
  const supabase = createClient();
  const router = useRouter();
  const [invite, setInvite] = useState<{ id: string; from: string } | null>(null);
  const [toast, setToast] = useState<{ text: string; duelId?: string } | null>(null);
  const [cancelAlert, setCancelAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const names = useRef<Map<string, string>>(new Map());
  const statuses = useRef<Map<string, string>>(new Map());
  const handled = useRef<Set<string>>(new Set());
  const loaded = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const presChannel = useRef<any>(null);
  const myPresence = useRef<PresenceStatus | null>(null);

  const check = useCallback(async () => {
    const { data } = await supabase
      .from('duels')
      .select('id, challenger, opponent, status, canceled_by')
      .in('status', ['pending', 'active', 'declined', 'canceled'])
      .order('created_at', { ascending: false });
    if (!data) return;

    if (names.current.size === 0) {
      const { data: profs } = await supabase.from('profiles').select('id, display_name');
      profs?.forEach((p) => names.current.set(p.id as string, p.display_name as string));
    }

    const first = !loaded.current;
    let pendingForMe: DuelLite | null = null;

    for (const d of data as DuelLite[]) {
      const prev = statuses.current.get(d.id);
      statuses.current.set(d.id, d.status);

      if (d.opponent === me && d.status === 'pending' && !handled.current.has(d.id)) {
        pendingForMe = pendingForMe ?? d;
      }

      // tell the challenger what happened (only on observed transitions)
      if (!first && d.challenger === me && prev === 'pending') {
        const who = names.current.get(d.opponent) ?? '???';
        if (d.status === 'active') {
          // accepted: pull the challenger straight into the game too
          setToast({ text: `${who} accepted! ⚔️` });
          router.push(`/duels?duel=${d.id}`);
        } else if (d.status === 'declined') {
          setToast({ text: `${who} declined. ❌` });
        }
      }

      // either side canceled an open duel: both players land back in the
      // shootouts lobby, the non-canceler gets the alert
      if (
        !first &&
        (d.challenger === me || d.opponent === me) &&
        (prev === 'active' || prev === 'pending') &&
        d.status === 'canceled'
      ) {
        router.push('/duels');
        if (d.canceled_by && d.canceled_by !== me) {
          setCancelAlert(names.current.get(d.canceled_by) ?? '???');
        }
      }
    }

    setInvite((cur) => {
      if (pendingForMe) {
        return cur?.id === pendingForMe.id
          ? cur
          : { id: pendingForMe.id, from: names.current.get(pendingForMe.challenger) ?? '???' };
      }
      return null; // invite was handled elsewhere (e.g. on the duels page)
    });

    // keep my presence status current: "dueling" while I have an active duel
    const hasActive = (data as DuelLite[]).some(
      (d) => d.status === 'active' && (d.challenger === me || d.opponent === me)
    );
    const want: PresenceStatus = hasActive ? 'dueling' : 'online';
    if (presChannel.current && myPresence.current !== want) {
      myPresence.current = want;
      presChannel.current.track({ status: want, at: Date.now() });
    }

    loaded.current = true;
  }, [me, supabase]);

  useEffect(() => {
    check();
    const ch = supabase
      .channel('challenge-watch')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'duels' }, () => check())
      .subscribe();
    const poll = setInterval(check, 7000);
    const onVisible = () => {
      if (!document.hidden) check();
    };
    document.addEventListener('visibilitychange', onVisible);

    // presence: announce myself, mirror everyone's state into the store
    const pres = supabase.channel('presence-bros', { config: { presence: { key: me } } });
    presChannel.current = pres;
    pres
      .on('presence', { event: 'sync' }, () => {
        const raw = pres.presenceState() as Record<string, { status?: string; at?: number }[]>;
        const map = new Map<string, PresenceStatus>();
        for (const [uid, metas] of Object.entries(raw)) {
          // a player may have several tabs reporting; trust the newest one
          let latest: { status?: string; at?: number } | undefined;
          for (const m of metas) {
            if (!latest || (m.at ?? 0) > (latest.at ?? 0)) latest = m;
          }
          map.set(uid, latest?.status === 'dueling' ? 'dueling' : 'online');
        }
        setPresence(map);
      })
      .subscribe((s) => {
        if (s === 'SUBSCRIBED') {
          myPresence.current = 'online';
          pres.track({ status: 'online', at: Date.now() });
          // immediately correct to "dueling" if a duel is already active
          check();
        }
      });

    return () => {
      supabase.removeChannel(ch);
      supabase.removeChannel(pres);
      presChannel.current = null;
      setPresence(new Map());
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [check, supabase, me]);

  // browser-tab title ping while an invite is waiting
  useEffect(() => {
    if (!invite) return;
    const orig = document.title;
    document.title = '⚽ ¡Te retaron! · ' + orig;
    return () => {
      document.title = orig;
    };
  }, [invite]);

  // auto-dismiss toasts
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6500);
    return () => clearTimeout(t);
  }, [toast]);

  async function respond(accept: boolean) {
    if (!invite) return;
    setBusy(true);
    handled.current.add(invite.id);
    const id = invite.id;
    await supabase.rpc('duel_respond', { p_duel: id, p_accept: accept });
    setBusy(false);
    setInvite(null);
    if (accept) router.push(`/duels?duel=${id}`);
  }

  return (
    <>
      {invite && (
        <div className="chal-backdrop">
          <div className="chal-modal">
            <div className="chal-icon">🥅</div>
            <div className="chal-title">{invite.from} challenges you!</div>
            <div className="chal-sub">Penalty shootout · best of 5 · bragging rights on the line</div>
            <div className="chal-actions">
              <button className="save-btn" disabled={busy} onClick={() => respond(true)}>
                Accept
              </button>
              <button className="chal-decline" disabled={busy} onClick={() => respond(false)}>
                Decline
              </button>
            </div>
          </div>
        </div>
      )}

      {cancelAlert && (
        <div className="chal-backdrop">
          <div className="chal-modal">
            <div className="chal-icon">❌</div>
            <div className="chal-title">{cancelAlert} has canceled the game.</div>
            <div className="chal-actions">
              <button className="save-btn" onClick={() => setCancelAlert(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <button
          className="chal-toast"
          onClick={() => {
            const id = toast.duelId;
            setToast(null);
            if (id) router.push(`/duels?duel=${id}`);
          }}
        >
          {toast.text}
          {toast.duelId ? ' · Play now →' : ''}
        </button>
      )}
    </>
  );
}
