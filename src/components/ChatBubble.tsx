'use client';

import React, { useState, useRef, useEffect, useCallback, useSyncExternalStore } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getPresence, getServerPresence, subscribePresence } from '@/lib/presenceStore';
import { GUEST_NAME } from '@/lib/players';
import { flagUrl } from '@/lib/flags';
import {
  GROUP_CONV_NAME,
  dmTickState,
  seenByCount,
  unreadCount,
  shortTime,
  type ChatMessage,
  type ChatConversation,
  type RosterPlayer,
  type TickState,
} from '@/lib/chat';

const DESKTOP_BTN = 56;
const MOBILE_BTN = 65;
const MARGIN = 20;
const GAP = 12;

const GROUP_KEY = 'group'; // local key for the group room in the maps below

export default function ChatBubble({ me }: { me: string }) {
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false); // hold the bubble until the home intro finishes
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ---- View: conversation list, or one open thread ------------------------
  // activeOther = null  -> the group room is open
  // activeOther = uid   -> a DM with that player is open
  const [view, setView] = useState<'list' | 'thread'>('list');
  const [activeOther, setActiveOther] = useState<string | null>(null);

  // ---- Data ---------------------------------------------------------------
  const [roster, setRoster] = useState<RosterPlayer[]>([]);
  const names = useRef<Map<string, RosterPlayer>>(new Map());
  const [groupConvId, setGroupConvId] = useState<string | null>(null);
  // otherUserId -> dm conversation id (only for DMs that exist yet)
  const dmConvByUser = useRef<Map<string, string>>(new Map());
  // conversationId -> { kind, other } so we can route realtime rows
  const convInfo = useRef<Map<string, { kind: 'group' | 'dm'; other: string | null }>>(new Map());
  // conversationId -> messages (ascending)
  const [messages, setMessages] = useState<Map<string, ChatMessage[]>>(new Map());
  // Mirror of messages for read-marking, so markRead can read the latest
  // message time without depending on (and churning with) messages state.
  const messagesRef = useRef(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  // conversationId -> (userId -> last_read_at)
  const [reads, setReads] = useState<Map<string, Map<string, string>>>(new Map());

  const activeConvId = activeOther === null ? groupConvId : (dmConvByUser.current.get(activeOther) ?? null);

  // ---- Presence (online dots + DM "delivered") ----------------------------
  // Reads the shared presence store that ChallengeWatcher already populates
  // site-wide, so the chat and home page agree on who is online and we never
  // open a second presence channel (which can disrupt the first).
  const presence = useSyncExternalStore(subscribePresence, getPresence, getServerPresence);
  const isOnline = useCallback((id: string) => presence.has(id) && id !== me, [presence, me]);

  const [btnSize, setBtnSize] = useState(DESKTOP_BTN);

  useEffect(() => {
    const update = () => setBtnSize(window.innerWidth < 768 ? MOBILE_BTN : DESKTOP_BTN);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // ---- Data loading -------------------------------------------------------
  const loadStatic = useCallback(async () => {
    // Roster: approved players, excluding me and the view-only guest.
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, display_name, color, flag_code, status')
      .order('display_name', { ascending: true });
    if (profs) {
      const roomMates: RosterPlayer[] = [];
      for (const p of profs as Array<RosterPlayer & { status?: string }>) {
        names.current.set(p.id, { id: p.id, display_name: p.display_name, color: p.color, flag_code: p.flag_code });
        if (p.id === me) continue;
        if (p.display_name === GUEST_NAME) continue;
        if (p.status && p.status !== 'approved') continue;
        roomMates.push({ id: p.id, display_name: p.display_name, color: p.color, flag_code: p.flag_code });
      }
      setRoster(roomMates);
    }
  }, [supabase, me]);

  const refresh = useCallback(async () => {
    // Conversations I can see: the group room + my DMs.
    const { data: convs } = await supabase
      .from('chat_conversations')
      .select('id, kind, user_a, user_b');
    if (convs) {
      for (const c of convs as ChatConversation[]) {
        if (c.kind === 'group') {
          setGroupConvId((g) => g ?? c.id);
          convInfo.current.set(c.id, { kind: 'group', other: null });
        } else {
          const other = c.user_a === me ? c.user_b : c.user_a;
          if (other) {
            dmConvByUser.current.set(other, c.id);
            convInfo.current.set(c.id, { kind: 'dm', other });
          }
        }
      }
    }

    // Messages (RLS already scopes to my conversations + last 24h).
    const { data: msgs } = await supabase
      .from('chat_messages')
      .select('id, conversation_id, sender_id, body, created_at')
      .order('created_at', { ascending: true });
    if (msgs) {
      const map = new Map<string, ChatMessage[]>();
      for (const m of msgs as ChatMessage[]) {
        const arr = map.get(m.conversation_id) ?? [];
        arr.push(m);
        map.set(m.conversation_id, arr);
      }
      setMessages(map);
    }

    // Read watermarks for every member of my conversations.
    const { data: rds } = await supabase
      .from('chat_reads')
      .select('conversation_id, user_id, last_read_at');
    if (rds) {
      setReads((prev) => {
        const map = new Map<string, Map<string, string>>();
        for (const r of rds as Array<{ conversation_id: string; user_id: string; last_read_at: string }>) {
          const inner = map.get(r.conversation_id) ?? new Map<string, string>();
          inner.set(r.user_id, r.last_read_at);
          map.set(r.conversation_id, inner);
        }
        // Never move a read marker backwards: a fresh local read (optimistic, or
        // from realtime) must not be clobbered by a slightly stale DB row.
        for (const [conv, inner] of prev) {
          const m = map.get(conv) ?? new Map<string, string>();
          for (const [uid, t] of inner) {
            const cur = m.get(uid);
            if (!cur || new Date(t).getTime() > new Date(cur).getTime()) m.set(uid, t);
          }
          map.set(conv, m);
        }
        return map;
      });
    }
  }, [supabase, me]);

  // ---- Mark a conversation read ------------------------------------------
  const markRead = useCallback(async (convId: string) => {
    // The watermark must cover every message currently loaded, regardless of any
    // skew between this device's clock and the server's. Messages are stamped
    // with server time, so if the phone clock is behind, a plain Date.now() can
    // land before a just-read message and make it pop back as unread. Use the
    // newest loaded message time when it's ahead of the local clock.
    const arr = messagesRef.current.get(convId) ?? [];
    let latest = 0;
    for (const m of arr) {
      const t = new Date(m.created_at).getTime();
      if (t > latest) latest = t;
    }
    const iso = new Date(Math.max(Date.now(), latest)).toISOString();
    setReads((prev) => {
      const next = new Map(prev);
      const inner = new Map(next.get(convId) ?? new Map<string, string>());
      inner.set(me, iso);
      next.set(convId, inner);
      return next;
    });
    // Persist via a security-definer RPC: a direct PostgREST upsert writes every
    // payload column (incl. the PK) in its ON CONFLICT UPDATE, which the
    // column-level grant on chat_reads rejects on the 2nd+ read — so the
    // watermark would silently freeze at the first read and old messages keep
    // re-appearing as unread on every reload. The RPC also clamps with
    // greatest() so the watermark can never move backwards.
    await supabase.rpc('chat_mark_read', { p_conv: convId, p_at: iso });
  }, [supabase, me]);

  // ---- Initial load + realtime + polling ---------------------------------
  useEffect(() => {
    loadStatic();
    refresh();

    // Note: chaining two postgres_changes `.on()` calls trips a supabase-js
    // typing overload, so register them as separate statements on the channel.
    const ch = supabase.channel('chat-stream');
    ch.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'chat_messages' },
      (payload) => {
        const m = payload.new as ChatMessage;
        setMessages((prev) => {
          const next = new Map(prev);
          const arr = next.get(m.conversation_id) ?? [];
          if (arr.some((x) => x.id === m.id)) return prev; // de-dupe own echo
          next.set(m.conversation_id, [...arr, m]);
          return next;
        });
      },
    );
    ch.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'chat_reads' },
      (payload) => {
        const r = payload.new as { conversation_id: string; user_id: string; last_read_at: string };
        if (!r?.conversation_id) return;
        setReads((prev) => {
          const next = new Map(prev);
          const inner = new Map(next.get(r.conversation_id) ?? new Map<string, string>());
          inner.set(r.user_id, r.last_read_at);
          next.set(r.conversation_id, inner);
          return next;
        });
      },
    );
    ch.subscribe();

    const poll = setInterval(refresh, 7000);
    const onVisible = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      supabase.removeChannel(ch);
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [supabase, loadStatic, refresh]);

  // Keep the active thread scrolled to the newest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, view, activeOther, open]);

  // Show the bubble only after the home intro animation has finished. On pages
  // without the intro (the `.home-intro` marker is absent) it appears at once.
  // A fallback timer guarantees it shows even if the event is ever missed.
  useEffect(() => {
    if (!document.querySelector('.home-intro')) { setReady(true); return; }
    const onDone = () => setReady(true);
    window.addEventListener('bm-intro-done', onDone);
    const fallback = setTimeout(() => setReady(true), 8000);
    return () => { window.removeEventListener('bm-intro-done', onDone); clearTimeout(fallback); };
  }, []);

  // When a thread is open and focused, keep my read watermark current.
  useEffect(() => {
    if (!open || view !== 'thread' || !activeConvId) return;
    markRead(activeConvId);
  }, [open, view, activeConvId, messages, markRead]);

  // ---- Unread counts ------------------------------------------------------
  const unreadFor = useCallback((convId: string | null): number => {
    if (!convId) return 0;
    const arr = messages.get(convId) ?? [];
    const myRead = reads.get(convId)?.get(me);
    return unreadCount(arr, myRead, me);
  }, [messages, reads, me]);

  const totalUnread = (() => {
    let n = 0;
    for (const convId of messages.keys()) {
      // Don't count the thread that's open in front of the user.
      if (open && view === 'thread' && convId === activeConvId) continue;
      n += unreadFor(convId);
    }
    return n;
  })();

  // ---- Open a conversation ------------------------------------------------
  const openConversation = useCallback(async (other: string | null) => {
    setError(null);
    if (other === null) {
      setActiveOther(null);
      setView('thread');
      if (groupConvId) markRead(groupConvId);
      return;
    }
    let convId = dmConvByUser.current.get(other);
    if (!convId) {
      const { data, error: rpcErr } = await supabase.rpc('chat_open_dm', { p_other: other });
      if (rpcErr || !data) { setError('Could not open that chat.'); return; }
      convId = data as string;
      dmConvByUser.current.set(other, convId);
      convInfo.current.set(convId, { kind: 'dm', other });
    }
    setActiveOther(other);
    setView('thread');
    markRead(convId);
  }, [supabase, groupConvId, markRead]);

  // ---- Send ---------------------------------------------------------------
  const send = useCallback(async (text: string) => {
    if (!activeConvId) { setError('Chat not ready yet.'); return; }
    setSending(true);
    setError(null);
    const { data, error: insErr } = await supabase
      .from('chat_messages')
      .insert({ conversation_id: activeConvId, sender_id: me, body: text })
      .select('id, conversation_id, sender_id, body, created_at')
      .single();
    setSending(false);
    if (insErr || !data) { setError('Message failed to send.'); return; }
    const m = data as ChatMessage;
    setMessages((prev) => {
      const next = new Map(prev);
      const arr = next.get(m.conversation_id) ?? [];
      if (arr.some((x) => x.id === m.id)) return prev;
      next.set(m.conversation_id, [...arr, m]);
      return next;
    });
    markRead(activeConvId);
  }, [supabase, activeConvId, me, markRead]);


  // ---- Render helpers -----------------------------------------------------
  const activeMsgs = activeConvId ? (messages.get(activeConvId) ?? []) : [];
  const otherMemberIds = roster.map((r) => r.id); // group members besides me
  const lastOwnIdx = (() => { for (let i = activeMsgs.length - 1; i >= 0; i--) if (activeMsgs[i].sender_id === me) return i; return -1; })();

  function nameOf(id: string): string {
    return names.current.get(id)?.display_name ?? '???';
  }
  function colorOf(id: string): string {
    return names.current.get(id)?.color ?? 'var(--gold)';
  }
  function flagOf(id: string): string | null {
    return flagUrl(names.current.get(id)?.flag_code ?? null);
  }

  const headerTitle = view === 'list' ? 'Chat' : (activeOther === null ? GROUP_CONV_NAME : nameOf(activeOther));
  const groupOnlineCount = roster.filter((r) => isOnline(r.id)).length;
  const selfOnline = presence.has(me); // I'm present in the shared presence store
  let headerSub: string | null = null;
  let headerOnline = false; // drives the green live dot in the header
  if (view === 'thread') {
    if (activeOther !== null) {
      headerOnline = isOnline(activeOther);
      headerSub = headerOnline ? 'online' : 'offline';
    } else {
      headerOnline = groupOnlineCount > 0;
      headerSub = groupOnlineCount > 0 ? `${groupOnlineCount} online` : 'no one else online';
    }
  } else {
    // List view: show my own live status so I can see I'm connected.
    headerOnline = selfOnline;
    headerSub = selfOnline ? "You're live" : 'connecting…';
  }

  return (
    <>
      {/* Floating toggle button */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close chat' : 'Open chat'}
        style={{
          position: 'fixed',
          right: MARGIN,
          bottom: MARGIN,
          width: btnSize,
          height: btnSize,
          padding: 0,
          borderRadius: '50%',
          border: open ? 'none' : '1px solid var(--gold)',
          cursor: 'pointer',
          background: open ? 'var(--gold)' : 'var(--bg-light)',
          color: open ? 'var(--bg-dark)' : 'var(--gold)',
          boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
          opacity: ready ? 1 : 0,
          pointerEvents: ready ? 'auto' : 'none',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'opacity 400ms ease, background 200ms ease, color 200ms ease',
        }}
      >
        {open ? (
          <span style={{ fontSize: 26, lineHeight: 1, fontWeight: 700 }}>×</span>
        ) : (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: 'none' }}>
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
        )}
        {!open && totalUnread > 0 && (
          <span
            aria-label={`${totalUnread} unread`}
            style={{
              position: 'absolute', top: -2, right: -2, minWidth: 20, height: 20, padding: '0 5px',
              borderRadius: 10, background: 'var(--danger)', color: '#3a0d06', fontSize: 12, fontWeight: 800,
              display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--bg-dark)',
            }}
          >
            {totalUnread > 99 ? '99+' : totalUnread}
          </span>
        )}
      </button>

      {/* Chat panel */}
      <div
        style={{
          position: 'fixed',
          right: MARGIN,
          bottom: MARGIN + btnSize + GAP,
          width: 360,
          maxWidth: 'calc(100vw - 40px)',
          height: 520,
          maxHeight: 'calc(100vh - 140px)',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-dark)',
          border: '1px solid var(--line)',
          borderRadius: 12,
          boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
          zIndex: 1000,
          overflow: 'hidden',
          transformOrigin: 'bottom right',
          transform: open ? 'translateY(0) scale(1)' : 'translateY(12px) scale(0.92)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 180ms ease, transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1)',
          fontFamily: 'var(--sans)',
        }}
      >
        {/* Header */}
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
          {view === 'thread' && (
            <button
              onClick={() => { setView('list'); setActiveOther(null); }}
              aria-label="Back"
              style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 0, display: 'flex' }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 14, fontWeight: 800, letterSpacing: '.04em', color: 'var(--cream)', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {view === 'thread' && activeOther !== null && flagOf(activeOther) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={flagOf(activeOther)!} alt="" style={{ width: 20, height: 14, objectFit: 'cover', borderRadius: 2, flexShrink: 0 }} />
              )}
              {headerTitle}
            </div>
            {headerSub && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: headerOnline ? '#5fcf97' : 'var(--dim)' }}>
                {headerOnline && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#5fcf97', boxShadow: '0 0 6px #5fcf97' }} />}
                {headerSub}
              </div>
            )}
          </div>
          <button onClick={() => setOpen(false)} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
        </div>

        {/* LIST VIEW */}
        {view === 'list' && (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <ConversationRow
              title={GROUP_CONV_NAME}
              subtitle="Everyone"
              avatar={<span style={{ fontSize: 18 }}>⚽</span>}
              avatarBg="rgba(0, 0, 0, 0.6)"
              unread={unreadFor(groupConvId)}
              onClick={() => openConversation(null)}
            />
            {roster.map((p) => (
              <ConversationRow
                key={p.id}
                title={p.display_name}
                subtitle={isOnline(p.id) ? 'online' : 'tap to chat'}
                subtitleColor={isOnline(p.id) ? '#5fcf97' : undefined}
                avatar={<span style={{ fontWeight: 800, color: 'var(--gold)' }}>{p.display_name.charAt(0).toUpperCase()}</span>}
                avatarBg="rgba(0, 0, 0, 0.6)"
                avatarImg={flagUrl(p.flag_code)}
                online={isOnline(p.id)}
                unread={unreadFor(dmConvByUser.current.get(p.id) ?? null)}
                onClick={() => openConversation(p.id)}
              />
            ))}
            {roster.length === 0 && (
              <div style={{ padding: 20, fontSize: 13, color: 'var(--dim)', textAlign: 'center' }}>No other players yet.</div>
            )}
          </div>
        )}

        {/* THREAD VIEW */}
        {view === 'thread' && (
          <>
            <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {activeMsgs.length === 0 && (
                <div style={{ margin: 'auto', fontSize: 13, color: 'var(--dim)', textAlign: 'center', lineHeight: 1.6 }}>
                  No messages yet.<br />Say something — messages disappear after 24 hours.
                </div>
              )}
              {activeMsgs.map((m, i) => {
                const mine = m.sender_id === me;
                const showName = !mine && activeOther === null;
                let receipt: React.ReactNode = null;
                if (mine) {
                  if (activeOther === null) {
                    // Group room: "Seen by N" on my latest message only.
                    if (i === lastOwnIdx && activeConvId) {
                      const seen = seenByCount(m.created_at, otherMemberIds, reads.get(activeConvId) ?? new Map());
                      receipt = (
                        <span style={{ fontSize: 10, color: seen >= otherMemberIds.length && otherMemberIds.length > 0 ? '#4aa3ff' : 'var(--dim)' }}>
                          {seen === 0 ? 'Sent' : seen >= otherMemberIds.length ? 'Read by all' : `Seen by ${seen}`}
                        </span>
                      );
                    }
                  } else if (activeConvId) {
                    // DM: WhatsApp ticks.
                    const otherRead = reads.get(activeConvId)?.get(activeOther);
                    const state = dmTickState(m.created_at, otherRead, isOnline(activeOther));
                    receipt = (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        {state === 'read' && i === lastOwnIdx && (
                          <span style={{ fontSize: 10, color: '#4aa3ff' }}>Read</span>
                        )}
                        <Ticks state={state} />
                      </span>
                    );
                  }
                }
                return (
                  <div key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%', display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start' }}>
                    {showName && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: colorOf(m.sender_id), margin: '0 4px 2px' }}>
                        {flagOf(m.sender_id) && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={flagOf(m.sender_id)!} alt="" style={{ width: 16, height: 11, objectFit: 'cover', borderRadius: 2 }} />
                        )}
                        {nameOf(m.sender_id)}
                      </span>
                    )}
                    <div style={{
                      padding: '7px 11px',
                      borderRadius: 12,
                      fontSize: 14,
                      lineHeight: 1.45,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      color: 'var(--cream)',
                      background: mine ? 'rgba(230,179,55,0.18)' : 'var(--card)',
                      border: `1px solid ${mine ? 'rgba(230,179,55,0.35)' : 'var(--line)'}`,
                    }}>
                      {m.body}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, margin: '2px 4px 0' }}>
                      <span style={{ fontSize: 10, color: 'var(--dim)' }}>{shortTime(m.created_at)}</span>
                      {receipt}
                    </div>
                  </div>
                );
              })}
              {error && <div style={{ fontSize: 12, color: 'var(--danger)', textAlign: 'center' }}>{error}</div>}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const q = input.trim();
                if (!q || sending) return;
                setInput('');
                send(q);
                // Keep focus on the input so the mobile keyboard stays open.
                inputRef.current?.focus();
              }}
              style={{ display: 'flex', gap: 8, padding: 10, borderTop: '1px solid var(--line)' }}
            >
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type a message…"
                maxLength={2000}
                enterKeyHint="send"
                style={{
                  flex: 1, padding: '9px 12px', fontSize: 14, borderRadius: 8,
                  border: '1px solid var(--line)', background: 'var(--bg-light)', color: 'var(--cream)', outline: 'none',
                }}
              />
              <button
                type="submit"
                // Don't let tapping Send pull focus off the input (which would
                // dismiss the mobile keyboard).
                onMouseDown={(e) => e.preventDefault()}
                disabled={sending || !input.trim()}
                style={{
                  padding: '9px 14px', fontSize: 13, fontWeight: 800, borderRadius: 8, border: 'none',
                  cursor: sending || !input.trim() ? 'default' : 'pointer',
                  opacity: sending || !input.trim() ? 0.5 : 1,
                  color: 'var(--bg-dark)', background: 'var(--gold)',
                }}
              >
                Send
              </button>
            </form>
          </>
        )}
      </div>
    </>
  );
}

// ---- Small presentational pieces ------------------------------------------
function ConversationRow({
  title, subtitle, subtitleColor, avatar, avatarBg, avatarImg, online, unread, onClick,
}: {
  title: string;
  subtitle: string;
  subtitleColor?: string;
  avatar: React.ReactNode;
  avatarBg: string;
  avatarImg?: string | null;
  online?: boolean;
  unread: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '11px 14px',
        background: 'none', border: 'none', borderBottom: '1px solid var(--line)', cursor: 'pointer', textAlign: 'left',
      }}
    >
      <span style={{ position: 'relative', flexShrink: 0 }}>
        <span style={{ width: 38, height: 38, borderRadius: '50%', background: avatarBg, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          {avatarImg ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarImg} alt="" style={{ width: 24, height: 'auto', borderRadius: 2 }} />
          ) : (
            avatar
          )}
        </span>
        {online && (
          <span style={{ position: 'absolute', right: -1, bottom: -1, width: 11, height: 11, borderRadius: '50%', background: '#5fcf97', border: '2px solid var(--bg-dark)' }} />
        )}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: 'var(--cream)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
        <span style={{ display: 'block', fontSize: 11, color: subtitleColor ?? 'var(--dim)' }}>{subtitle}</span>
      </span>
      {unread > 0 && (
        <span style={{ minWidth: 20, height: 20, padding: '0 6px', borderRadius: 10, background: 'var(--danger)', color: '#3a0d06', fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </button>
  );
}

function Ticks({ state }: { state: TickState }) {
  const color = state === 'read' ? '#4aa3ff' : 'var(--dim)';
  if (state === 'sent') {
    return (
      <svg width="15" height="11" viewBox="0 0 15 11" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-label="sent">
        <path d="M2 6 l3 3.4 L13 1.6" />
      </svg>
    );
  }
  return (
    <svg width="18" height="11" viewBox="0 0 18 11" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-label={state}>
      <path d="M1 6 l3 3.4 L11.5 1.6" />
      <path d="M6 6 l3 3.4 L16.5 1.6" />
    </svg>
  );
}
