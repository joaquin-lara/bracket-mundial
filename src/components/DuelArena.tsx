'use client';

import gsap from 'gsap';
import { useCallback, useEffect, useRef, useState } from 'react';
import PresenceDot from '@/components/PresenceDot';
import { flagUrl } from '@/lib/flags';
import { PLAYER_META, type Player } from '@/lib/players';
import { createClient } from '@/lib/supabase/client';

type Pick = 'left' | 'center' | 'right';

interface Round {
  kick: number;
  shooter: string;
  shot: Pick;
  dive: Pick;
  goal: boolean;
}

interface Duel {
  id: string;
  challenger: string;
  opponent: string;
  status: 'pending' | 'active' | 'declined' | 'finished' | 'canceled';
  kick: number;
  challenger_score: number;
  opponent_score: number;
  rounds: Round[];
  shooter_picked: boolean;
  keeper_picked: boolean;
  winner: string | null;
  created_at: string;
}

interface Profile {
  id: string;
  display_name: string;
}

const DUEL_COLS =
  'id, challenger, opponent, status, kick, challenger_score, opponent_score, rounds, shooter_picked, keeper_picked, winner, created_at';

// ── CPU practice mode (local only, never stored) ────────────────────────────
const CPU_ID = 'cpu-bot';
const CPU_DUEL_ID = 'cpu-duel';
const PICKS: Pick[] = ['left', 'center', 'right'];

function freshCpuDuel(me: string): Duel {
  return {
    id: CPU_DUEL_ID,
    challenger: me,
    opponent: CPU_ID,
    status: 'active',
    kick: 1,
    challenger_score: 0,
    opponent_score: 0,
    rounds: [],
    shooter_picked: false,
    keeper_picked: false,
    winner: null,
    created_at: new Date().toISOString(),
  };
}

/** Same win logic as the database referee: best of 5, then sudden death. */
function judge(kick: number, ch: number, op: number): { done: boolean; chWins?: boolean } {
  if (kick <= 10) {
    const chTaken = Math.ceil(kick / 2);
    const opTaken = Math.floor(kick / 2);
    if (ch > op + (5 - opTaken)) return { done: true, chWins: true };
    if (op > ch + (5 - chTaken)) return { done: true, chWins: false };
    if (kick === 10 && ch !== op) return { done: true, chWins: ch > op };
  } else if (kick % 2 === 0 && ch !== op) {
    return { done: true, chWins: ch > op };
  }
  return { done: false };
}

// goal-mouth target coordinates in the SVG scene
const TARGETS: Record<Pick, { x: number; y: number }> = {
  left: { x: 130, y: 128 },
  center: { x: 200, y: 118 },
  right: { x: 270, y: 128 },
};

// deterministic crowd (must render identically on server and client)
const CROWD = Array.from({ length: 160 }, (_, i) => ({
  x: 14 + (i % 32) * 11.7 + ((i * 7) % 6),
  y: 38 + Math.floor(i / 32) * 12,
  c: i % 3,
}));
const CROWD_FILLS = ['#1d5a47', '#16493a', '#27654f'];
const CONFETTI_COLORS = ['#e6b337', '#7fc8a9', '#c9a0dc', '#e89a7c', '#f4f1e8'];

export default function DuelArena({
  me,
  profiles,
  initialDuelId = null,
}: {
  me: string;
  profiles: Profile[];
  initialDuelId?: string | null;
}) {
  const supabase = createClient();
  const [duels, setDuels] = useState<Duel[]>([]);
  const [activeId, setActiveId] = useState<string | null>(initialDuelId);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [animating, setAnimating] = useState(false);

  const ballRef = useRef<SVGGElement>(null);
  const keeperRef = useRef<SVGGElement>(null);
  const strikerRef = useRef<SVGGElement>(null);
  const trailRef = useRef<SVGLineElement>(null);
  const confettiRef = useRef<SVGGElement>(null);
  const netRef = useRef<SVGGElement>(null);
  const animatedKicks = useRef<Map<string, number>>(new Map());

  const [cpuDuel, setCpuDuel] = useState<Duel | null>(null);
  const [cpuRecord, setCpuRecord] = useState({ w: 0, l: 0 });
  const [sdFlash, setSdFlash] = useState(false);
  const sdShown = useRef<Set<string>>(new Set());

  const nameOf = useCallback(
    (id: string) =>
      id === CPU_ID ? 'CPU 🤖' : profiles.find((p) => p.id === id)?.display_name ?? '???',
    [profiles]
  );
  const metaOf = (id: string) => PLAYER_META[nameOf(id) as Player];

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from('duels')
      .select(DUEL_COLS)
      .order('created_at', { ascending: false });
    if (data) setDuels(data as unknown as Duel[]);
  }, [supabase]);

  useEffect(() => {
    // Run game time on the real clock: no slow-motion catch-up after the
    // tab was hidden — animations land exactly where they should be.
    gsap.ticker.lagSmoothing(0);
    refresh();
    const channel = supabase
      .channel('duel-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'duels' }, () => refresh())
      .subscribe();
    const poll = setInterval(refresh, 5000);
    const onVisible = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh, supabase]);

  // Follow deep links even if the arena is already mounted (e.g. the
  // challenger was sitting in the lobby when their challenge got accepted).
  useEffect(() => {
    if (initialDuelId) setActiveId(initialDuelId);
  }, [initialDuelId]);

  // If the duel being viewed gets canceled (by either side), drop back to
  // the lobby; the global watcher shows the cancellation alert.
  useEffect(() => {
    const d = duels.find((x) => x.id === activeId);
    if (d && d.status === 'canceled') setActiveId(null);
  }, [duels, activeId]);

  async function endGame(duelId: string) {
    if (duelId === CPU_DUEL_ID) {
      setCpuDuel(null);
      setActiveId(null);
      return;
    }
    await rpc('duel_cancel', { p_duel: duelId });
    setActiveId(null);
  }

  const duel = activeId === CPU_DUEL_ID ? cpuDuel : duels.find((d) => d.id === activeId) ?? null;

  function startCpu() {
    animatedKicks.current.set(CPU_DUEL_ID, 0);
    sdShown.current.delete(CPU_DUEL_ID);
    setCpuDuel(freshCpuDuel(me));
    setActiveId(CPU_DUEL_ID);
  }

  // one-time MUERTE SÚBITA flash when a duel reaches sudden death (after
  // the equalizer's reveal animation finishes, never during it)
  useEffect(() => {
    if (!duel || duel.status !== 'active' || duel.kick <= 10 || animating) return;
    if (sdShown.current.has(duel.id)) return;
    sdShown.current.add(duel.id);
    setSdFlash(true);
    const t = setTimeout(() => setSdFlash(false), 2300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duel?.id, duel?.kick, duel?.status, animating]);

  function cpuPick(myPick: Pick) {
    setCpuDuel((d) => {
      if (!d || d.status !== 'active') return d;
      const iShoot = d.kick % 2 === 1; // I'm the challenger in CPU games
      const botPick = PICKS[Math.floor(Math.random() * 3)];
      const shot = iShoot ? myPick : botPick;
      const dive = iShoot ? botPick : myPick;
      const goal = shot !== dive;
      const ch = d.challenger_score + (goal && iShoot ? 1 : 0);
      const op = d.opponent_score + (goal && !iShoot ? 1 : 0);
      const verdict = judge(d.kick, ch, op);
      if (verdict.done) {
        setCpuRecord((r) => (verdict.chWins ? { ...r, w: r.w + 1 } : { ...r, l: r.l + 1 }));
      }
      return {
        ...d,
        challenger_score: ch,
        opponent_score: op,
        rounds: [...d.rounds, { kick: d.kick, shooter: iShoot ? me : CPU_ID, shot, dive, goal }],
        kick: d.kick + 1,
        status: verdict.done ? 'finished' : 'active',
        winner: verdict.done ? (verdict.chWins ? me : CPU_ID) : null,
      };
    });
  }

  // ── reveal animation when a new resolved kick arrives ──────────────────────
  useEffect(() => {
    if (!duel) return;
    const seen = animatedKicks.current.get(duel.id);
    const rounds = duel.rounds ?? [];
    if (seen === undefined) {
      animatedKicks.current.set(duel.id, rounds.length);
      return;
    }
    if (rounds.length <= seen) return;
    animatedKicks.current.set(duel.id, rounds.length);

    // Tab hidden: the kick still "happens" — resolve instantly, no queued
    // replay when the player comes back.
    if (document.hidden) {
      setAnimating(false);
      setBanner(null);
      return;
    }

    const round = rounds[rounds.length - 1];
    const ball = ballRef.current;
    const keeper = keeperRef.current;
    const striker = strikerRef.current;
    const trail = trailRef.current;
    const net = netRef.current;
    if (!ball || !keeper || !striker || !trail) return;

    setAnimating(true);
    setBanner(null);
    const shot = TARGETS[round.shot];
    const diveX = TARGETS[round.dive].x - 200;

    const confettiBurst = () => {
      const bits = confettiRef.current?.children;
      if (!bits) return;
      Array.from(bits).forEach((bit, i) => {
        gsap.fromTo(
          bit,
          { x: 0, y: 0, rotation: 0, opacity: 1 },
          {
            x: -100 + Math.random() * 200,
            y: -30 + Math.random() * 110,
            rotation: Math.random() * 540,
            opacity: 0,
            duration: 0.9 + Math.random() * 0.5,
            delay: (i % 6) * 0.02,
            ease: 'power2.out',
          }
        );
      });
    };

    const tl = gsap.timeline({
      onComplete: () => {
        setAnimating(false);
        setBanner(null);
        gsap.set(ball, { x: 0, y: 0, scale: 1 });
        gsap.set(keeper, { x: 0, y: 0, rotation: 0, scaleY: 1 });
        gsap.set(striker, { x: 0, rotation: 0 });
        gsap.set(trail, { opacity: 0 });
      },
    });

    tl.set(ball, { x: 0, y: 0, scale: 1 })
      .set(keeper, { x: 0, y: 0, rotation: 0, scaleY: 1 })
      .set(striker, { x: 0, rotation: 0 })
      .set(trail, { opacity: 0, attr: { x1: 200, y1: 224, x2: 200, y2: 224 } })
      // run-up + keeper anticipation crouch
      .to(striker, { x: -16, duration: 0.34, ease: 'power1.out' })
      .to(keeper, { scaleY: 0.9, y: 4, duration: 0.34, transformOrigin: '50% 100%' }, '<')
      // the strike
      .to(striker, { x: 12, rotation: 10, transformOrigin: '50% 85%', duration: 0.14, ease: 'power3.in' })
      .add('launch', '>-0.02')
      .to(
        keeper,
        {
          x: diveX,
          y: round.dive === 'center' ? -6 : -14,
          rotation: round.dive === 'center' ? 0 : round.dive === 'left' ? -32 : 32,
          scaleY: round.dive === 'center' ? 0.82 : 1,
          duration: 0.42,
          ease: 'power2.out',
        },
        'launch'
      )
      .fromTo(
        trail,
        { opacity: 0.9, attr: { x1: 200, y1: 224, x2: 200, y2: 224 } },
        { attr: { x2: shot.x, y2: shot.y }, duration: 0.42, ease: 'power2.in' },
        'launch'
      )
      .to(ball, { x: shot.x - 200, y: shot.y - 228, scale: 0.62, duration: 0.42, ease: 'power2.in' }, 'launch')
      .to(trail, { opacity: 0, duration: 0.22 }, 'launch+=0.42')
      .add(() => {
        setBanner(round.goal ? '¡GOOOOL!' : '¡ATAJADO!');
        if (round.goal) {
          confettiBurst();
          if (net) {
            gsap.fromTo(
              net,
              { scale: 1, transformOrigin: '50% 30%' },
              { scale: 1.035, duration: 0.1, yoyo: true, repeat: 3 }
            );
          }
        }
      }, 'launch+=0.43')
      .to(
        ball,
        round.goal
          ? { y: shot.y - 216, duration: 0.26, ease: 'bounce.out' }
          : { x: diveX, y: -58, scale: 0.55, duration: 0.3, ease: 'power1.out' },
        'launch+=0.45'
      )
      .to({}, { duration: 1.35 });
  }, [duel]);

  // ── actions ────────────────────────────────────────────────────────────────
  async function rpc(fn: string, args: Record<string, unknown>) {
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) {
      setMsg(error.message);
      return null;
    }
    await refresh();
    return data as unknown;
  }

  async function challenge(opponent: string) {
    const id = await rpc('duel_create', { p_opponent: opponent });
    if (typeof id === 'string') setActiveId(id);
  }

  const others = profiles.filter((p) => p.id !== me);
  const pending = duels.filter((d) => d.status === 'pending');
  const active = duels.filter((d) => d.status === 'active');
  const finished = duels.filter((d) => d.status === 'finished');

  const record = (other: string) => {
    let w = 0;
    let l = 0;
    for (const d of finished) {
      if (!((d.challenger === me && d.opponent === other) || (d.challenger === other && d.opponent === me)))
        continue;
      if (d.winner === me) w++;
      else if (d.winner === other) l++;
    }
    return { w, l };
  };

  // ── game view ──────────────────────────────────────────────────────────────
  if (duel && (duel.status === 'active' || duel.status === 'finished')) {
    const shooterId = duel.kick % 2 === 1 ? duel.challenger : duel.opponent;
    const keeperId = shooterId === duel.challenger ? duel.opponent : duel.challenger;
    const iShoot = shooterId === me;

    // Two reveal timings: scores/dots update with the GOL/ATAJADO banner;
    // shirts, role tags, and sudden-death effects wait for the figures to
    // reset (the same beat the YOU marker switches player).
    const allRounds = duel.rounds ?? [];
    const lastRound = allRounds[allRounds.length - 1];
    const holdVisual = animating && !!lastRound;
    const holdScore = animating && !banner && !!lastRound;
    const displayShooterId = holdVisual ? lastRound.shooter : shooterId;
    const displayKeeperId =
      displayShooterId === duel.challenger ? duel.opponent : duel.challenger;
    const shooterColor = metaOf(displayShooterId)?.color ?? '#8fb0a1';
    const keeperColor = metaOf(displayKeeperId)?.color ?? '#8fb0a1';
    const shownRounds = holdScore ? allRounds.slice(0, -1) : allRounds;
    const shownScore = (pid: string) =>
      shownRounds.filter((r) => r.shooter === pid && r.goal).length;
    const suddenDeath = duel.kick > 10 && duel.status === 'active' && !holdVisual;
    const iPicked = iShoot ? duel.shooter_picked : duel.keeper_picked;
    const theyPicked = iShoot ? duel.keeper_picked : duel.shooter_picked;

    const kickDots = (playerId: string) => {
      const taken = shownRounds.filter((r) => r.shooter === playerId);
      const dots = [];
      const total = Math.max(5, taken.length);
      for (let i = 0; i < total; i++) {
        const r = taken[i];
        dots.push(
          <span key={i} className={`duel-dot ${r ? (r.goal ? 'dd-goal' : 'dd-miss') : 'dd-todo'}`} />
        );
      }
      return dots;
    };

    return (
      <div>
        <button className="link-btn duel-back" onClick={() => setActiveId(null)}>
          ← Back to lobby
        </button>

        <div className="duel-scoreboard">
          {[duel.challenger, duel.opponent].map((pid) => (
            <div
              className={`duel-player${pid === displayShooterId && duel.status === 'active' ? ' shooting' : ''}`}
              key={pid}
            >
              <span className="duel-pname">
                {metaOf(pid) && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={flagUrl(metaOf(pid).flagCode)!} alt="" className="heat-flag" />
                )}
                {nameOf(pid)}
                {duel.winner === pid && ' 🏆'}
                {duel.status === 'active' && (
                  <span className="duel-role-tag">{pid === displayShooterId ? '⚽' : '🧤'}</span>
                )}
              </span>
              <span className="duel-pscore">{shownScore(pid)}</span>
              <span className="duel-dots">{kickDots(pid)}</span>
            </div>
          ))}
        </div>

        <div className="duel-scene">
          <svg viewBox="0 0 400 260" className={`duel-svg${suddenDeath ? ' sd' : ''}`}>
            <defs>
              <linearGradient id="dSky" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#03150f" />
                <stop offset="100%" stopColor="#0a3526" />
              </linearGradient>
              <linearGradient id="dGrass" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#147350" />
                <stop offset="100%" stopColor="#0c4030" />
              </linearGradient>
              <linearGradient id="dBeam" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(244,241,232,0.22)" />
                <stop offset="100%" stopColor="rgba(244,241,232,0)" />
              </linearGradient>
              <linearGradient id="dTrail" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor="rgba(230,179,55,0)" />
                <stop offset="100%" stopColor="rgba(230,179,55,0.9)" />
              </linearGradient>
            </defs>

            {/* night sky + stands + crowd */}
            <rect x="0" y="0" width="400" height="185" fill="url(#dSky)" />
            <rect x="0" y="30" width="400" height="66" fill="#07271c" />
            {CROWD.map((c, i) => (
              <circle
                key={i}
                cx={c.x.toFixed(1)}
                cy={c.y}
                r="1.8"
                fill={CROWD_FILLS[c.c]}
                className={`duel-crowd-${c.c}`}
              />
            ))}

            {/* floodlights */}
            <polygon points="36,14 130,185 -50,185" fill="url(#dBeam)" className="duel-beam" />
            <polygon points="364,14 450,185 270,185" fill="url(#dBeam)" className="duel-beam b2" />
            <line x1="36" y1="2" x2="36" y2="16" stroke="#0c4434" strokeWidth="4" />
            <line x1="364" y1="2" x2="364" y2="16" stroke="#0c4434" strokeWidth="4" />
            <rect x="26" y="10" width="20" height="7" rx="2" fill="#f4f1e8" className="duel-lamp" />
            <rect x="354" y="10" width="20" height="7" rx="2" fill="#f4f1e8" className="duel-lamp" />

            {/* sudden death: sweeping spots, red tint, smoke flares */}
            {suddenDeath && (
              <g>
                <rect x="0" y="0" width="400" height="260" fill="rgba(255,80,60,0.07)" className="duel-sd-tint" />
                <polygon points="130,0 190,185 70,185" fill="url(#dBeam)" className="duel-sweep" />
                <polygon points="270,0 330,185 210,185" fill="url(#dBeam)" className="duel-sweep s2" />
                <g transform="translate(56 88)">
                  <circle r="5" fill="#ff5a3c" className="duel-flare" />
                  <circle cy="-10" r="7" fill="rgba(255,90,60,0.35)" className="duel-smoke" />
                  <circle cy="-20" r="9" fill="rgba(255,120,90,0.22)" className="duel-smoke b" />
                  <circle cy="-32" r="11" fill="rgba(244,241,232,0.14)" className="duel-smoke c" />
                </g>
                <g transform="translate(344 88)">
                  <circle r="5" fill="#ff5a3c" className="duel-flare" />
                  <circle cy="-10" r="7" fill="rgba(255,90,60,0.35)" className="duel-smoke b" />
                  <circle cy="-20" r="9" fill="rgba(255,120,90,0.22)" className="duel-smoke c" />
                  <circle cy="-32" r="11" fill="rgba(244,241,232,0.14)" className="duel-smoke" />
                </g>
              </g>
            )}

            {/* pitch */}
            <rect x="0" y="185" width="400" height="75" fill="url(#dGrass)" />
            <rect x="0" y="197" width="400" height="11" fill="rgba(244,241,232,0.03)" />
            <rect x="0" y="219" width="400" height="11" fill="rgba(244,241,232,0.03)" />
            <rect x="0" y="241" width="400" height="11" fill="rgba(244,241,232,0.03)" />
            <line x1="0" y1="186" x2="400" y2="186" stroke="rgba(244,241,232,0.5)" strokeWidth="2.5" />
            <path
              d="M 56 258 L 106 191 L 294 191 L 344 258"
              fill="none"
              stroke="rgba(244,241,232,0.4)"
              strokeWidth="2.5"
            />
            <path d="M 152 258 Q 200 236 248 258" fill="none" stroke="rgba(244,241,232,0.35)" strokeWidth="2" />

            {/* side netting + net */}
            <polygon points="78,70 78,186 58,186" fill="rgba(244,241,232,0.05)" />
            <polygon points="322,70 322,186 342,186" fill="rgba(244,241,232,0.05)" />
            <g ref={netRef}>
              <g stroke="rgba(244,241,232,0.16)" strokeWidth="1">
                {Array.from({ length: 13 }, (_, i) => (
                  <line key={`v${i}`} x1={80 + i * 20} y1={70} x2={80 + i * 20} y2={185} />
                ))}
                {Array.from({ length: 6 }, (_, i) => (
                  <line key={`h${i}`} x1={80} y1={88 + i * 18} x2={320} y2={88 + i * 18} />
                ))}
                <line x1="78" y1="70" x2="58" y2="186" />
                <line x1="322" y1="70" x2="342" y2="186" />
              </g>
            </g>

            {/* posts */}
            <g stroke="#f4f1e8" strokeWidth="6" strokeLinecap="round" fill="none">
              <path d="M 78 188 L 78 70 L 322 70 L 322 188" />
            </g>

            {/* keeper */}
            <g ref={keeperRef}>
              <g transform="translate(200 150)">
                <g className={`keeper-idle${animating ? ' hold' : ''}`}>
                  <circle cx="0" cy="-24" r="9" fill="#f4f1e8" />
                  <rect x="-7" y="-15" width="14" height="26" rx="5" fill={keeperColor} />
                  <line x1="-7" y1="-10" x2="-22" y2="-22" stroke={keeperColor} strokeWidth="5" strokeLinecap="round" className="keeper-arm-l" />
                  <line x1="7" y1="-10" x2="22" y2="-22" stroke={keeperColor} strokeWidth="5" strokeLinecap="round" className="keeper-arm-r" />
                  <line x1="-4" y1="11" x2="-7" y2="30" stroke="#f4f1e8" strokeWidth="5" strokeLinecap="round" />
                  <line x1="4" y1="11" x2="7" y2="30" stroke="#f4f1e8" strokeWidth="5" strokeLinecap="round" />
                </g>
              </g>
            </g>

            {/* striker */}
            <g ref={strikerRef}>
              <g transform="translate(156 222)">
                <circle cx="0" cy="-26" r="8" fill="#f4f1e8" />
                <rect x="-6" y="-18" width="12" height="22" rx="4" fill={shooterColor} />
                <line x1="-6" y1="-12" x2="-15" y2="-3" stroke={shooterColor} strokeWidth="4" strokeLinecap="round" />
                <line x1="6" y1="-12" x2="14" y2="-5" stroke={shooterColor} strokeWidth="4" strokeLinecap="round" />
                <line x1="-3" y1="4" x2="-7" y2="20" stroke="#f4f1e8" strokeWidth="4" strokeLinecap="round" />
                <line x1="3" y1="4" x2="11" y2="17" stroke="#f4f1e8" strokeWidth="4" strokeLinecap="round" />
              </g>
            </g>

            {/* YOU marker */}
            {duel.status === 'active' && !animating && (
              <g transform={iShoot ? 'translate(156 180)' : 'translate(200 96)'}>
                <g className="duel-you-bob">
                  <rect x="-21" y="-15" width="42" height="16" rx="5" fill="#e6b337" />
                  <text x="0" y="-3" textAnchor="middle" className="duel-you-text">
                    YOU
                  </text>
                  <path d="M -5 1 L 5 1 L 0 8 Z" fill="#e6b337" />
                </g>
              </g>
            )}

            {/* shot trail + ball */}
            <line ref={trailRef} x1="200" y1="224" x2="200" y2="224" stroke="url(#dTrail)" strokeWidth="4" strokeLinecap="round" opacity="0" />
            <g ref={ballRef}>
              <g transform="translate(200 228)">
                <ellipse cx="2" cy="9" rx="10" ry="3" fill="rgba(0,0,0,0.3)" />
                <g>
                  <circle r="11" fill="#f4f1e8" />
                  <circle r="3" fill="#0b3d2c" />
                  <circle cx="-6" cy="-5" r="2" fill="#0b3d2c" />
                  <circle cx="6" cy="-5" r="2" fill="#0b3d2c" />
                  <circle cx="0" cy="7" r="2" fill="#0b3d2c" />
                </g>
              </g>
            </g>

            {/* confetti (hidden until a goal) */}
            <g transform="translate(200 122)">
              <g ref={confettiRef}>
                {Array.from({ length: 24 }, (_, i) => (
                  <rect
                    key={i}
                    x="-3"
                    y="-3"
                    width="6"
                    height="6"
                    rx="1"
                    fill={CONFETTI_COLORS[i % CONFETTI_COLORS.length]}
                    opacity="0"
                  />
                ))}
              </g>
            </g>

            {/* broadcast scorebug */}
            <g transform="translate(200 8)">
              <rect x="-80" y="0" width="160" height="26" rx="7" className="sb-plate" />
              {[
                { pid: duel.challenger, x: -72 },
                { pid: duel.opponent, x: 50 },
              ].map(({ pid, x }) => {
                const meta = metaOf(pid);
                const url = meta ? flagUrl(meta.flagCode) : null;
                return url ? (
                  <image
                    key={pid}
                    href={url}
                    x={x}
                    y={5}
                    width={22}
                    height={16}
                    preserveAspectRatio="xMidYMid slice"
                  />
                ) : (
                  <g key={pid}>
                    <rect x={x} y={5} width={22} height={16} rx={2} fill="rgba(244,241,232,0.15)" />
                    <text x={x + 11} y={16.5} textAnchor="middle" className="sb-cpu">
                      CPU
                    </text>
                  </g>
                );
              })}
              <text x="0" y="18" textAnchor="middle" className="sb-score">
                {shownScore(duel.challenger)} – {shownScore(duel.opponent)}
              </text>
            </g>

            {banner && (
              <text
                x="200"
                y="48"
                textAnchor="middle"
                className={`duel-banner ${banner.includes('GO') ? 'goal' : 'save'}`}
              >
                {banner}
              </text>
            )}

            {sdFlash && (
              <g className="duel-sd-pop">
                <rect x="62" y="103" width="276" height="46" rx="10" fill="rgba(4,21,15,0.88)" stroke="#ff5a3c" strokeWidth="1.5" />
                <text x="200" y="133" textAnchor="middle" className="duel-sd-text">
                  MUERTE SÚBITA
                </text>
              </g>
            )}
          </svg>

          {duel.status === 'finished' && !animating && (
            <div className="duel-overlay">
              <div className="duel-overlay-score">
                {duel.challenger_score} – {duel.opponent_score}
              </div>
              <div className="duel-final-title">
                {(() => {
                  const winnerKicks = (duel.rounds ?? []).filter((r) => r.shooter === duel.winner);
                  const perfect = winnerKicks.length >= 5 && winnerKicks.every((r) => r.goal);
                  if (duel.winner === me) {
                    return perfect ? 'You win! Como un animal! 🏆' : 'You win! Que crack. 🏆';
                  }
                  const w = nameOf(duel.winner ?? '');
                  return perfect
                    ? `${w} wins. Te rompieron el orto che. 💩`
                    : `${w} wins. La cagaste. 💩`;
                })()}
              </div>
              <div className="duel-overlay-actions">
                <button
                  className="save-btn"
                  disabled={busy}
                  onClick={() =>
                    duel.id === CPU_DUEL_ID
                      ? startCpu()
                      : challenge(duel.challenger === me ? duel.opponent : duel.challenger)
                  }
                >
                  Rematch
                </button>
                <button className="link-btn" onClick={() => setActiveId(null)}>
                  Back to lobby
                </button>
              </div>
            </div>
          )}
        </div>

        {duel.status === 'finished' ? null : animating ? (
          <p className="duel-status">…</p>
        ) : !iPicked ? (
          <div>
            <div className={`duel-role ${iShoot ? 'shoot' : 'keep'}`}>
              <span className="duel-role-icon">{iShoot ? '⚽' : '🧤'}</span>
              <span>
                {iShoot ? 'YOU SHOOT' : 'YOU KEEP'}
                <small>
                  {iShoot ? 'Pick a corner to bury it' : `${nameOf(shooterId)} is shooting — guess the dive`}{' '}
                  · kick {duel.kick}
                </small>
              </span>
            </div>
            <div className="duel-targets">
              {(['left', 'center', 'right'] as Pick[]).map((p) => (
                <button
                  key={p}
                  className={`duel-target${iShoot ? '' : ' keep'}`}
                  disabled={busy}
                  onClick={() =>
                    duel.id === CPU_DUEL_ID
                      ? cpuPick(p)
                      : rpc('duel_submit_pick', { p_duel: duel.id, p_pick: p })
                  }
                >
                  {iShoot
                    ? p === 'left'
                      ? '← Shoot left'
                      : p === 'center'
                        ? '• Shoot center'
                        : 'Shoot right →'
                    : p === 'left'
                      ? '← Dive left'
                      : p === 'center'
                        ? '• Stay center'
                        : 'Dive right →'}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p className="duel-status waiting">
            {theyPicked ? 'Revealing…' : `Waiting for ${nameOf(iShoot ? keeperId : shooterId)}…`}
          </p>
        )}

        {duel.status === 'active' && (
          <div className="duel-endwrap">
            <button className="duel-end" disabled={busy} onClick={() => endGame(duel.id)}>
              End game
            </button>
          </div>
        )}

        {msg && <p className="msg-err">{msg}</p>}
      </div>
    );
  }

  // ── lobby ──────────────────────────────────────────────────────────────────
  return (
    <div>
      <div className="groups-head">
        <span className="groups-title">Challenge</span>
        <div className="contenders-line" />
      </div>
      <div className="duel-lobby-grid">
        {others.map((p) => {
          const r = record(p.id);
          const meta = PLAYER_META[p.display_name as Player];
          return (
            <div className="duel-card" key={p.id}>
              <span className="player-avatar" style={{ background: 'rgba(0,0,0,0.5)' }}>
                {meta && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={flagUrl(meta.flagCode)!} alt="" className="contender-flag" />
                )}
              </span>
              <div className="duel-card-name">
                {p.display_name} <PresenceDot userId={p.id} />
              </div>
              <div className="duel-record">
                {r.w}W – {r.l}L
              </div>
              <button className="save-btn" disabled={busy} onClick={() => challenge(p.id)}>
                Challenge
              </button>
            </div>
          );
        })}
        <div className="duel-card duel-card-cpu">
          <span className="player-avatar" style={{ background: 'rgba(0,0,0,0.5)', fontSize: 22 }}>
            🤖
          </span>
          <div className="duel-card-name">CPU</div>
          <div className="duel-record">
            {cpuRecord.w}W – {cpuRecord.l}L this session
          </div>
          <button className="save-btn" onClick={startCpu}>
            Practice
          </button>
        </div>
      </div>

      {(pending.length > 0 || active.length > 0) && (
        <>
          <div className="groups-head">
            <span className="groups-title">Open duels</span>
            <div className="contenders-line" />
          </div>
          {pending.map((d) => (
            <div className="duel-row" key={d.id}>
              <span>
                {nameOf(d.challenger)} challenged {nameOf(d.opponent)}
              </span>
              {d.opponent === me ? (
                <span className="duel-row-actions">
                  <button
                    className="save-btn"
                    disabled={busy}
                    onClick={async () => {
                      await rpc('duel_respond', { p_duel: d.id, p_accept: true });
                      setActiveId(d.id);
                    }}
                  >
                    Accept
                  </button>
                  <button className="link-btn" disabled={busy} onClick={() => rpc('duel_respond', { p_duel: d.id, p_accept: false })}>
                    Decline
                  </button>
                </span>
              ) : (
                <span className="duel-waiting">waiting…</span>
              )}
            </div>
          ))}
          {active.map((d) => (
            <div className="duel-row" key={d.id}>
              <span>
                {nameOf(d.challenger)} {d.challenger_score} – {d.opponent_score} {nameOf(d.opponent)}
                {(d.kick % 2 === 1 ? d.challenger : d.opponent) === me &&
                !(d.kick % 2 === 1 ? d.shooter_picked : d.keeper_picked)
                  ? ' · your move'
                  : ''}
              </span>
              <span className="duel-row-actions">
                <button className="save-btn" onClick={() => setActiveId(d.id)}>
                  Play
                </button>
                <button className="duel-end" disabled={busy} onClick={() => endGame(d.id)}>
                  End
                </button>
              </span>
            </div>
          ))}
        </>
      )}

      {finished.length > 0 && (
        <>
          <div className="groups-head">
            <span className="groups-title">History</span>
            <div className="contenders-line" />
          </div>
          {finished.slice(0, 10).map((d) => (
            <div className="duel-row done" key={d.id}>
              <span>
                {nameOf(d.challenger)} {d.challenger_score} – {d.opponent_score} {nameOf(d.opponent)}
              </span>
              <span className="duel-winner-tag">{nameOf(d.winner ?? '')} 🏆</span>
            </div>
          ))}
        </>
      )}

      {msg && <p className="msg-err">{msg}</p>}
    </div>
  );
}
