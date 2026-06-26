'use client';

import { useEffect, useState, type FormEvent } from 'react';

const BTN_SIZE = 56;
const MARGIN = 20;
const GAP = 12;

const GREETINGS = [
  'Hey, I’m right here 👋',
  'Ask me anything about the app!',
  'Stuck on something? I’ve got you.',
  'Need help? Just tap me.',
  'Got questions? I’m all ears.',
  'Not sure how this works? Ask away.',
];

type ClippyQA = { q: string; a: string };
type ClippyCategory = { id: string; title: string; emoji: string; items: ClippyQA[] };

const CATEGORIES: ClippyCategory[] = [
  {
    id: 'bracket',
    title: 'Bracket & scoring',
    emoji: '⚽',
    items: [
      {
        q: 'How do I make a pick?',
        a: 'Go to View your bracket and enter the score you think a match will end on. You can change it as often as you want until 10 minutes before kickoff, then it locks for good.',
      },
      {
        q: 'How are points scored?',
        a: '3 points for an exact score, 2 points for the right outcome (winner or draw) with a wrong scoreline, 1 point if you locked a pick but got the outcome wrong, 0 if you never picked.',
      },
      {
        q: 'Can other people see my picks?',
        a: 'No — picks are hidden until the match kicks off. After that everyone’s picks are revealed.',
      },
      {
        q: 'How do penalty shootouts count for scoring?',
        a: 'Knockout matches are judged on the score at the end of play, including extra time. A match decided on penalties counts as a draw for scoring purposes.',
      },
    ],
  },
  {
    id: 'gamblers',
    title: 'Gamblers',
    emoji: '🎲',
    items: [
      {
        q: 'What is Gamblers?',
        a: 'A fake-money side game. Everyone starts with $1000 and bets on match winners, exact scores, or stat markets like corners, shots, cards and possession.',
      },
      {
        q: 'What’s a parlay?',
        a: 'Tap "+ add another market" on a match card to stack up to 4 picks on that game into one ticket for a bigger combined multiplier. Miss a single leg and you lose the whole parlay.',
      },
      {
        q: 'When do bets lock?',
        a: 'Same as bracket picks — 10 minutes before kickoff.',
      },
    ],
  },
  {
    id: 'odds',
    title: 'Live Odds',
    emoji: '📈',
    items: [
      {
        q: 'What is Live Odds?',
        a: 'Real-time win probabilities for today’s matches, pulled from Polymarket. It only shows games that haven’t finished yet.',
      },
    ],
  },
  {
    id: 'duels',
    title: 'Penalty Shootouts',
    emoji: '🥅',
    items: [
      {
        q: 'How do Penalty Shootouts work?',
        a: 'Challenge another player to a 1v1 shootout: best of 5 penalties, then sudden death if it’s still tied.',
      },
    ],
  },
  {
    id: 'achievements',
    title: 'Achievements',
    emoji: '🏆',
    items: [
      {
        q: 'What are achievements?',
        a: 'Hidden milestones you unlock by playing. They stay secret until you earn them — check the Achievements page to see your progress.',
      },
    ],
  },
  {
    id: 'chat',
    title: 'Chat',
    emoji: '💬',
    items: [
      {
        q: 'How does chat work?',
        a: 'The chat bubble (bottom-right) has a group room for everyone plus DMs with other players. Messages disappear after 24 hours.',
      },
    ],
  },
];

type SearchHit = { item: ClippyQA; categoryTitle: string };

const ALL_ITEMS: SearchHit[] = CATEGORIES.flatMap((c) => c.items.map((item) => ({ item, categoryTitle: c.title })));

const STOPWORDS = new Set([
  'what', 'when', 'where', 'how', 'why', 'who', 'which', 'does', 'do', 'did',
  'is', 'are', 'was', 'were', 'the', 'a', 'an', 'to', 'for', 'of', 'in', 'on',
  'and', 'or', 'my', 'i', 'you', 'me', 'can', 'with', 'about', 'this', 'that',
]);

function searchFaq(query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/).filter((w) => w.length > 2 && !STOPWORDS.has(w));
  if (words.length === 0) return [];
  return ALL_ITEMS
    .map((hit) => {
      const hay = `${hit.item.q} ${hit.item.a}`.toLowerCase();
      let score = 0;
      if (hay.includes(q)) score += 5;
      for (const w of words) if (hay.includes(w)) score += 1;
      return { hit, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((s) => s.hit);
}

export default function ClippyAssistant() {
  const [open, setOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [openQuestion, setOpenQuestion] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[] | null>(null);
  const [ready, setReady] = useState(false);
  const [bubble, setBubble] = useState<string | null>(null);
  const [greet, setGreet] = useState(false);
  const [thinking, setThinking] = useState(false);

  const category = CATEGORIES.find((c) => c.id === activeCategory) ?? null;

  // Wait for the home intro to finish (if one is playing) before popping up,
  // same gating ChatBubble uses, so the greeting doesn't appear under it.
  useEffect(() => {
    if (!document.querySelector('.home-intro')) { setReady(true); return; }
    const onDone = () => setReady(true);
    window.addEventListener('bm-intro-done', onDone);
    const fallback = setTimeout(() => setReady(true), 8000);
    return () => { window.removeEventListener('bm-intro-done', onDone); clearTimeout(fallback); };
  }, []);

  // Pop up a greeting a moment after the page settles, then fade it on its
  // own after a few seconds. Opening the panel dismisses it immediately.
  useEffect(() => {
    if (!ready) return;
    const showTimer = setTimeout(() => {
      setBubble(GREETINGS[Math.floor(Math.random() * GREETINGS.length)]);
    }, 900);
    return () => clearTimeout(showTimer);
  }, [ready]);

  useEffect(() => {
    if (!bubble) return;
    const hideTimer = setTimeout(() => setBubble(null), 6000);
    return () => clearTimeout(hideTimer);
  }, [bubble]);

  // One-shot wave when the greeting first appears, then settle back to the
  // regular idle wiggle while the bubble stays up.
  useEffect(() => {
    if (!bubble) return;
    setGreet(true);
    const t = setTimeout(() => setGreet(false), 1300);
    return () => clearTimeout(t);
  }, [bubble]);

  useEffect(() => {
    if (open) setBubble(null);
  }, [open]);

  function closeAndReset() {
    setOpen(false);
  }

  function ask(e: FormEvent) {
    e.preventDefault();
    const q = query;
    setActiveCategory(null);
    setOpenQuestion(null);
    setResults(null);
    setThinking(true);
    setTimeout(() => {
      setResults(searchFaq(q));
      setThinking(false);
    }, 500);
  }

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close help' : 'Open help'}
        style={{
          position: 'fixed',
          left: MARGIN,
          bottom: MARGIN,
          width: BTN_SIZE,
          height: BTN_SIZE,
          padding: 0,
          borderRadius: '50%',
          border: open ? 'none' : '1px solid var(--gold)',
          cursor: 'pointer',
          background: open ? 'var(--gold)' : 'var(--bg-light)',
          color: open ? 'var(--bg-dark)' : 'var(--gold)',
          boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 24,
          transition: 'background 200ms ease, color 200ms ease',
        }}
      >
        {open ? (
          <span style={{ fontSize: 26, lineHeight: 1, fontWeight: 700 }}>×</span>
        ) : (
          greet ? (
            <span className="clippy-wave">👋</span>
          ) : (
            <img
              src="/clippy.png"
              alt="Clippy"
              className="clippy-emoji"
              style={{ width: '75%', height: '75%', objectFit: 'cover', borderRadius: '50%' }}
            />
          )
        )}
      </button>

      <div
        role="status"
        style={{
          position: 'fixed',
          left: MARGIN + BTN_SIZE + 10,
          bottom: MARGIN + 14,
          maxWidth: 200,
          padding: '9px 12px',
          borderRadius: 14,
          background: 'var(--cream)',
          color: 'var(--bg-dark)',
          fontSize: 13,
          fontWeight: 700,
          lineHeight: 1.35,
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          zIndex: 999,
          transformOrigin: 'bottom left',
          transform: bubble ? 'translateY(0) scale(1)' : 'translateY(6px) scale(0.9)',
          opacity: bubble ? 1 : 0,
          pointerEvents: bubble ? 'auto' : 'none',
          transition: 'opacity 200ms ease, transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1)',
          fontFamily: 'var(--sans)',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: 'absolute', left: -6, bottom: 16, width: 0, height: 0,
            borderTop: '6px solid transparent', borderBottom: '6px solid transparent',
            borderRight: '6px solid var(--cream)',
          }}
        />
        {bubble}
        <button
          onClick={() => setBubble(null)}
          aria-label="Dismiss"
          style={{
            position: 'absolute', top: -7, right: -7, width: 18, height: 18, borderRadius: '50%',
            background: 'var(--bg-dark)', color: 'var(--cream)', border: '1px solid var(--line)',
            cursor: 'pointer', fontSize: 11, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          ×
        </button>
      </div>

      <div
        style={{
          position: 'fixed',
          left: MARGIN,
          bottom: MARGIN + BTN_SIZE + GAP,
          width: 340,
          maxWidth: 'calc(100vw - 40px)',
          maxHeight: 'calc(100vh - 140px)',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-dark)',
          border: '1px solid var(--line)',
          borderRadius: 12,
          boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
          zIndex: 1000,
          overflow: 'hidden',
          transformOrigin: 'bottom left',
          transform: open ? 'translateY(0) scale(1)' : 'translateY(12px) scale(0.92)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 180ms ease, transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1)',
          fontFamily: 'var(--sans)',
        }}
      >
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
          {category && (
            <button
              onClick={() => { setActiveCategory(null); setOpenQuestion(null); }}
              aria-label="Back"
              style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 0, display: 'flex' }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: '.04em', color: 'var(--cream)', textTransform: 'uppercase' }}>
              {category ? category.title : 'Clippy'}
            </div>
            {!category && <div style={{ fontSize: 11, color: 'var(--dim)' }}>Ask me how something works</div>}
          </div>
          <button onClick={closeAndReset} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
        </div>

        {!category && (
          <form onSubmit={ask} style={{ display: 'flex', gap: 8, padding: 10, borderBottom: '1px solid var(--line)' }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask a question…"
              style={{
                flex: 1, padding: '9px 12px', fontSize: 14, borderRadius: 8,
                border: '1px solid var(--line)', background: 'var(--bg-light)', color: 'var(--cream)', outline: 'none',
              }}
            />
            <button
              type="submit"
              disabled={!query.trim()}
              style={{
                padding: '9px 14px', fontSize: 13, fontWeight: 800, borderRadius: 8, border: 'none',
                cursor: query.trim() ? 'pointer' : 'default', opacity: query.trim() ? 1 : 0.5,
                color: 'var(--bg-dark)', background: 'var(--gold)',
              }}
            >
              Ask
            </button>
          </form>
        )}

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {!category && thinking && (
            <div style={{ padding: '14px', fontSize: 13, color: 'var(--dim)' }}>🤔 Thinking…</div>
          )}

          {!category && !thinking && results !== null && (
            <div style={{ padding: '10px 14px', fontSize: 12.5, color: 'var(--dim)', borderBottom: '1px solid var(--line)' }}>
              {results.length > 0 ? (
                <>✨ Here’s what I found for “{query.trim()}”:</>
              ) : (
                <>🤷 I don’t know that one yet. Here’s everything I can help with:</>
              )}
              <button
                onClick={() => { setResults(null); setQuery(''); }}
                style={{ marginLeft: 8, background: 'none', border: 'none', color: 'var(--gold)', cursor: 'pointer', fontSize: 12.5, fontWeight: 700, padding: 0 }}
              >
                Clear
              </button>
            </div>
          )}

          {!category && !thinking && results !== null && results.length > 0 &&
            results.map(({ item, categoryTitle }) => {
              const expanded = openQuestion === item.q;
              return (
                <div key={item.q} style={{ borderBottom: '1px solid var(--line)' }}>
                  <button
                    onClick={() => setOpenQuestion(expanded ? null : item.q)}
                    style={{
                      width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
                      padding: '11px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--dim)' }}>{categoryTitle}</span>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--cream)' }}>{item.q}</span>
                  </button>
                  {expanded && (
                    <div style={{ padding: '0 14px 12px', fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
                      {item.a}
                    </div>
                  )}
                </div>
              );
            })}

          {!category && !thinking && (results === null || results.length === 0) &&
            CATEGORIES.map((c) => (
              <button
                key={c.id}
                onClick={() => { setActiveCategory(c.id); setOpenQuestion(null); }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '11px 14px',
                  background: 'none', border: 'none', borderBottom: '1px solid var(--line)', cursor: 'pointer', textAlign: 'left',
                }}
              >
                <span style={{ width: 32, fontSize: 18, flexShrink: 0, textAlign: 'center' }}>{c.emoji}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--cream)' }}>{c.title}</span>
              </button>
            ))}

          {category &&
            category.items.map((item) => {
              const expanded = openQuestion === item.q;
              return (
                <div key={item.q} style={{ borderBottom: '1px solid var(--line)' }}>
                  <button
                    onClick={() => setOpenQuestion(expanded ? null : item.q)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                      padding: '11px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--cream)' }}>{item.q}</span>
                    <span style={{ color: 'var(--dim)', fontSize: 16, flexShrink: 0, transform: expanded ? 'rotate(45deg)' : 'none', transition: 'transform 150ms ease' }}>+</span>
                  </button>
                  {expanded && (
                    <div style={{ padding: '0 14px 12px', fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
                      {item.a}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </div>
    </>
  );
}
