'use client';

import gsap from 'gsap';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

// Run the reveal trigger before paint so the "who's shown" swap can't flash a frame.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
import PresenceDot from '@/components/PresenceDot';
import DuelEdge from '@/components/DuelEdge';
import { flagUrl } from '@/lib/flags';
import { sfx, isMuted, setMuted } from '@/lib/duelSfx';
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
// Confetti in each player's national flag colors (the scorer's burst).
const FLAG_CONFETTI: Record<string, string[]> = {
  Carlos: ['#0067C6', '#FFFFFF', '#C8A95B'], // Nicaragua
  Sebas: ['#4997D0', '#FFFFFF'], // Guatemala
  Mauri: ['#0073CF', '#FFFFFF'], // Honduras
  Joaquin: ['#D52B1E', '#FFFFFF', '#0039A6'], // Chile
};

export default function DuelArena({
  me,
  profiles,
  initialDuelId = null,
  isGuest = false,
}: {
  me: string;
  profiles: Profile[];
  initialDuelId?: string | null;
  isGuest?: boolean;
}) {
  const supabase = createClient();
  const [duels, setDuels] = useState<Duel[]>([]);
  const [activeId, setActiveId] = useState<string | null>(initialDuelId);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [animating, setAnimating] = useState(false);

  const ballRef = useRef<SVGGElement>(null);
  const ballYRef = useRef<SVGGElement>(null);
  const ballImgRef = useRef<SVGGElement>(null);
  const keeperRef = useRef<SVGGElement>(null);
  const strikerRef = useRef<SVGGElement>(null);
  const trailRef = useRef<SVGPathElement>(null);
  const confettiRef = useRef<SVGGElement>(null);
  const netRef = useRef<SVGGElement>(null);
  const sceneRef = useRef<SVGSVGElement>(null);
  const ambienceRef = useRef<HTMLAudioElement>(null);
  const drumsRef = useRef<HTMLAudioElement>(null);
  const oleRef = useRef<HTMLAudioElement>(null);
  const whistleRef = useRef<HTMLAudioElement>(null);
  const animatedKicks = useRef<Map<string, number>>(new Map());
  const sdArmed = useRef<Set<string>>(new Set());
  const [muted, setMutedState] = useState(false);
  useEffect(() => { setMutedState(isMuted()); }, []);

  // Loop background stadium ambience (public/minigame_sounds/stadium_noise.mp3)
  // while a game is open, unless muted. Silent no-op if the file isn't present.
  const inGame = !!duels.find((d) => d.id === activeId) || activeId === CPU_DUEL_ID;
  useEffect(() => {
    const a = ambienceRef.current;
    if (!a) return;
    if (inGame && !muted) {
      a.volume = 1;
      a.play().catch(() => {});
    } else {
      a.pause();
    }
  }, [inGame, muted]);

  const [cpuDuel, setCpuDuel] = useState<Duel | null>(null);
  const [cpuRecord, setCpuRecord] = useState({ w: 0, l: 0 });
  const [sdFlash, setSdFlash] = useState(false);
  const [sdLit, setSdLit] = useState(false);
  const sdShown = useRef<Set<string>>(new Set());
  const prevAnimating = useRef(false);

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

  const sdDrumsOn = sdLit && (duel?.status !== 'finished' || animating) && !muted;
  useEffect(() => {
    const d = drumsRef.current;
    if (!d) return;
    if (sdDrumsOn) {
      d.volume = 0.2;
      d.play().catch(() => {});
    } else {
      d.pause();
      d.currentTime = 0;
    }
  }, [sdDrumsOn]);

  const oleOn = duel?.status === 'finished' && !animating && duel?.winner === me && !muted;
  const loseWhistleOn = duel?.status === 'finished' && !animating && duel?.winner !== me && !!duel?.winner && !muted;
  useEffect(() => {
    const a = oleRef.current;
    if (!a) return;
    if (oleOn) {
      a.volume = 0.4;
      a.play().catch(() => {});
    } else {
      a.pause();
      a.currentTime = 0;
    }
  }, [oleOn]);

  useEffect(() => {
    const a = whistleRef.current;
    if (!a) return;
    if (loseWhistleOn) {
      a.volume = 0.3;
      a.play().catch(() => {});
    } else {
      a.pause();
      a.currentTime = 0;
    }
  }, [loseWhistleOn]);

  function startCpu() {
    animatedKicks.current.set(CPU_DUEL_ID, 0);
    sdShown.current.delete(CPU_DUEL_ID);
    sdArmed.current.delete(CPU_DUEL_ID);
    setSdLit(false);
    setCpuDuel(freshCpuDuel(me));
    setActiveId(CPU_DUEL_ID);
  }

  // one-time MUERTE SÚBITA flash, only at the REAL crossing into sudden death:
  // we must have witnessed this duel at kick <= 10 (armed) first, so opening a
  // game already in sudden death never flashes. Fires the instant the equalizing
  // kick's reveal finishes (the animating true->false edge).
  useEffect(() => {
    const justFinishedReveal = prevAnimating.current && !animating;
    prevAnimating.current = animating;
    if (!duel) return;
    if (duel.status === 'active' && duel.kick <= 10) sdArmed.current.add(duel.id);
    if (duel.status !== 'active' || duel.kick <= 10) return;
    if (sdShown.current.has(duel.id)) return;
    if (!sdArmed.current.has(duel.id)) return; // opened mid-sudden-death -> don't flash
    if (!justFinishedReveal) return;
    sdShown.current.add(duel.id);
    setSdFlash(true);
    setSdLit(true);
    const t = setTimeout(() => setSdFlash(false), 2300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duel?.id, duel?.kick, duel?.status, animating]);

  useEffect(() => { setSdLit(false); }, [duel?.id]);

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
  useIsoLayoutEffect(() => {
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

    const goal = round.goal;
    const decisive = duel.status === 'finished';
    const ballImg = ballImgRef.current;
    const ballY = ballYRef.current; // vertical axis (kept separate so x/y never fight)
    const scene = sceneRef.current;
    const q = (sel: string) => striker.querySelector<SVGElement>(sel);
    const legL = q('.s-leg-l'), legR = q('.s-leg-r'), armL = q('.s-arm-l'), armR = q('.s-arm-r');
    const netLines = net ? Array.from(net.querySelectorAll('line')) : [];
    const crowd = scene ? Array.from(scene.querySelectorAll<SVGElement>('.duel-crowd-0, .duel-crowd-1, .duel-crowd-2')) : [];
    const limbs = [legL, legR, armL, armR].filter(Boolean) as SVGElement[];

    const pal = FLAG_CONFETTI[nameOf(round.shooter)] ?? CONFETTI_COLORS;
    const confettiBurst = () => {
      const bits = confettiRef.current?.children;
      if (!bits) return;
      Array.from(bits).forEach((bit, i) => {
        gsap.set(bit, { attr: { fill: pal[i % pal.length] } });
        gsap.fromTo(bit, { x: 0, y: 0, rotation: 0, opacity: 1 }, {
          x: -110 + Math.random() * 220, y: -40 + Math.random() * 130, rotation: Math.random() * 720,
          opacity: 0, duration: 0.9 + Math.random() * 0.6, delay: (i % 6) * 0.02, ease: 'power2.out',
        });
      });
    };

    const reset = () => {
      gsap.set(striker, { x: 0, rotation: 0 });
      gsap.set(limbs, { rotation: 0 });
      gsap.set(ball, { x: 0 });
      gsap.set(ballY, { y: 0 });
      gsap.set(ballImg, { rotation: 0, scale: 1 });
      gsap.set(keeper, { clearProps: 'transform,transformOrigin' });
      gsap.set(trail, { opacity: 0, attr: { d: 'M 200 228 Q 200 228 200 228' } });
    };

    // Pin the start pose synchronously (before paint) so the first frame of the
    // reveal shows the kicker, not a popped/recolored frame.
    gsap.set(striker, { x: 0, rotation: 0 });
    gsap.set(limbs, { rotation: 0, transformOrigin: '50% 0%' });
    gsap.set(ball, { x: 0 });
    gsap.set(ballY, { y: 0 });
    gsap.set(ballImg, { rotation: 0, scale: 1, transformOrigin: '50% 50%' });
    gsap.set(keeper, { clearProps: 'transform,transformOrigin' });
    gsap.set(trail, { opacity: 0, attr: { d: 'M 200 228 Q 200 228 200 228' } });

    const tl = gsap.timeline({ onComplete: () => { setAnimating(false); setBanner(null); reset(); } });
    if (decisive) tl.timeScale(0.6); // slow-mo on the deciding kick
    tl.delay(1);

    // start pose: striker at idle position, ball/keeper home
    tl.set(striker, { x: 0, rotation: 0 })
      .set(limbs, { rotation: 0, transformOrigin: '50% 0%' })
      .set(ball, { x: 0 })
      .set(ballY, { y: 0 })
      .set(ballImg, { rotation: 0, scale: 1 })
      .set(keeper, { clearProps: 'transform,transformOrigin' })
      .set(trail, { opacity: 0, attr: { x1: 200, y1: 224, x2: 200, y2: 224 } });

    // run-up: legs cross and alternate (a real stride), arms pump opposite,
    // while the body travels toward the ball.
    tl.to(striker, { x: 42, duration: 0.72, ease: 'power1.in' }, 0)
      .fromTo(legL, { rotation: -26 }, { rotation: 26, duration: 0.18, repeat: 3, yoyo: true, ease: 'sine.inOut' }, 0)
      .fromTo(legR, { rotation: 26 }, { rotation: -26, duration: 0.18, repeat: 3, yoyo: true, ease: 'sine.inOut' }, 0)
      .fromTo(armL, { rotation: 22 }, { rotation: -22, duration: 0.18, repeat: 3, yoyo: true, ease: 'sine.inOut' }, 0)
      .fromTo(armR, { rotation: -22 }, { rotation: 22, duration: 0.18, repeat: 3, yoyo: true, ease: 'sine.inOut' }, 0)
      .to(keeper, { y: -3, duration: 0.18, repeat: 3, yoyo: true, ease: 'sine.inOut' }, 0);

    // plant, wind the kicking leg back, then swing it through and HOLD it
    // extended forward for the rest of the shot (no reset until idle).
    tl.set(limbs, { rotation: 0 }, 0.7)
      .to(legR, { rotation: 45, duration: 0.12, ease: 'power1.out' }, 0.72)
      .to(striker, { rotation: -6, duration: 0.12 }, 0.72)
      .to(legR, { rotation: -62, duration: 0.1, ease: 'power3.in' }, 0.86)
      .to(striker, { rotation: 8, duration: 0.14 }, 0.86)
      .add('launch', 0.94)
      .add(() => { sfx.kick(); sfx.whoosh(); }, 'launch');

    // ball: ONE clean parabola. x (horizontal) and y (vertical) live on SEPARATE
    // nested elements so their tweens can't fight over one transform matrix.
    // x is linear, y is quadratic -> y ∝ x². Spin + shrink ride on the inner group.
    // Trail traces the exact parabola: sub-bezier from t=0..τ has control (200+τ·Δx/2, 228).
    const trailProxy = { t: 0 };
    const dx = shot.x - 200, dy = shot.y - 228;
    tl.set(trail, { opacity: 0.9, attr: { d: 'M 200 228 Q 200 228 200 228' } }, 'launch')
      .fromTo(trailProxy, { t: 0 }, {
        t: 1, duration: 0.4, ease: 'none',
        onUpdate() {
          const t = trailProxy.t;
          trail.setAttribute('d',
            `M 200 228 Q ${200 + t * dx / 2} 228 ${200 + dx * t} ${228 + dy * t * t}`);
        },
      }, 'launch')
      .to(ball, { x: shot.x - 200, duration: 0.4, ease: 'none' }, 'launch')
      .to(ballY, { y: shot.y - 228, duration: 0.4, ease: 'power2.in' }, 'launch')
      .to(ballImg, { rotation: goal ? 560 : 380, scale: 0.58, duration: 0.4, ease: 'power1.in', transformOrigin: '50% 50%' }, 'launch')
      .to(trail, { opacity: 0, duration: 0.2 }, 'launch+=0.4');

    // keeper: explosive dive to the chosen side. The left dive is an exact mirror
    // of the right (same rotation magnitude, flipped via scaleX) so it never leans
    tl.to(keeper, {
        svgOrigin: '200 150',
        x: diveX, y: round.dive === 'center' ? -6 : -16,
        rotation: round.dive === 'center' ? 0 : round.dive === 'left' ? -38 : 38,
        scaleX: 1,
        scaleY: 1, duration: 0.4, ease: 'power2.out',
      }, 'launch');

    // impact
    tl.add(() => {
      setBanner(goal ? '¡GOOOOL!' : '¡ATAJADO!');
      if (goal) {
        sfx.goal();
        confettiBurst();
        if (netLines.length) gsap.fromTo(netLines, { strokeWidth: 1 },
          { strokeWidth: 2.4, duration: 0.12, yoyo: true, repeat: 1, ease: 'sine.out', stagger: { each: 0.012, from: 'center' } });
        if (net) gsap.fromTo(net, { scale: 1, transformOrigin: '50% 30%' }, { scale: 1.04, duration: 0.1, yoyo: true, repeat: 3 });
        if (crowd.length) gsap.fromTo(crowd, { y: 0 }, { y: -6, duration: 0.16, yoyo: true, repeat: 1, ease: 'power1.out', stagger: { each: 0.004, from: 'random' } });
        if (scene) gsap.fromTo(scene, { x: 0, y: 0 }, { x: 'random(-4,4)', y: 'random(-3,3)', duration: 0.05, repeat: 6, yoyo: true, clearProps: 'x,y' });
      } else {
        sfx.save();
        if (scene) gsap.fromTo(scene, { x: 0, y: 0 }, { x: 'random(-2,2)', duration: 0.05, repeat: 4, yoyo: true, clearProps: 'x,y' });
      }
    }, 'launch+=0.4');

    // ball settles in the net (goal) — or is parried wide and bounces on the grass (save)
    if (goal) {
      tl.to(ballY, { y: shot.y - 214, duration: 0.26, ease: 'bounce.out' }, 'launch+=0.42');
    } else {
      const deflectX = round.dive === 'left' ? -135 : round.dive === 'right' ? 135 : (round.shot === 'left' ? -120 : 120);
      tl.to(ball, { x: deflectX, duration: 0.55, ease: 'power2.out' }, 'launch+=0.42')
        .to(ballY, { y: 8, duration: 0.55, ease: 'bounce.out' }, 'launch+=0.42')
        .to(ballImg, { scale: 0.9, duration: 0.55, ease: 'power1.out' }, 'launch+=0.42');
    }

    if (decisive) tl.add(() => {
      sfx.win();
      if (scene) gsap.fromTo(scene, { x: 0, y: 0 }, { x: 'random(-5,5)', y: 'random(-4,4)', duration: 0.06, repeat: 8, yoyo: true, clearProps: 'x,y' });
    }, 'launch+=0.62');

    tl.to({}, { duration: decisive ? 1.8 : 1.3 });
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
    if (typeof id === 'string') {
      setActiveId(id);
      // Notify the challenged player on their phone (best-effort, never blocks UI).
      fetch('/api/push/duel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duelId: id }),
      }).catch(() => {});
    }
  }

  const others = profiles.filter((p) => p.id !== me);
  const isMine = (d: Duel) => d.challenger === me || d.opponent === me;
  const pending = duels.filter((d) => d.status === 'pending' && isMine(d));
  const active = duels.filter((d) => d.status === 'active' && isMine(d));
  const othersActive = duels.filter((d) => d.status === 'active' && !isMine(d));
  const finished = duels.filter((d) => d.status === 'finished' && isMine(d));
  const allFinished = duels.filter((d) => d.status === 'finished');

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
    const iAmIn = me === duel.challenger || me === duel.opponent; // false = spectator

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
          <button
            type="button"
            className="duel-mute"
            aria-label={muted ? 'Unmute' : 'Mute'}
            onClick={() => { const n = !muted; setMuted(n); setMutedState(n); }}
          >
            {muted ? '🔇' : '🔊'}
          </button>
          <audio ref={ambienceRef} src="/minigame_sounds/stadium_noise.mp3" loop preload="auto" />
          <audio ref={drumsRef} src="/minigame_sounds/drums.mp3" loop preload="auto" />
          <audio ref={oleRef} src="/minigame_sounds/ole_chant.mp3" loop preload="auto" />
          <audio ref={whistleRef} src="/minigame_sounds/fans_whistling.mp3" loop preload="auto" />
          <svg ref={sceneRef} viewBox="0 0 400 260" className={`duel-svg${sdLit ? ' sd' : ''}`}>
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
            {sdLit && (
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
                  {/* Each arm group: local origin = shoulder. Glove lives inside so idle wiggle carries both. */}
                  <g className="keeper-arm-l" transform="translate(-7 -10)">
                    <line x1="0" y1="0" x2="-15" y2="-12" stroke={keeperColor} strokeWidth="5" strokeLinecap="round" />
                    <g transform="translate(-25 -20) scale(-1,1) rotate(51) scale(-1,1)">
                      <image href="/goalie_gloves.png" x="-10" y="-13" width="20" height="26" preserveAspectRatio="xMidYMid meet" />
                    </g>
                  </g>
                  <g className="keeper-arm-r" transform="translate(7 -10)">
                    <line x1="0" y1="0" x2="15" y2="-12" stroke={keeperColor} strokeWidth="5" strokeLinecap="round" />
                    <g transform="translate(25 -20) rotate(51) scale(-1,1)">
                      <image href="/goalie_gloves.png" x="-10" y="-13" width="20" height="26" preserveAspectRatio="xMidYMid meet" />
                    </g>
                  </g>
                  <line x1="-4" y1="11" x2="-7" y2="30" stroke="#f4f1e8" strokeWidth="5" strokeLinecap="round" />
                  <line x1="4" y1="11" x2="7" y2="30" stroke="#f4f1e8" strokeWidth="5" strokeLinecap="round" />
                </g>
              </g>
            </g>

            {/* striker */}
            <g ref={strikerRef}>
              <g transform="translate(122 222)">
                <circle cx="0" cy="-26" r="8" fill="#f4f1e8" />
                <rect x="-6" y="-18" width="12" height="22" rx="4" fill={shooterColor} />
                <line className="s-arm-l" x1="-6" y1="-12" x2="-15" y2="-3" stroke={shooterColor} strokeWidth="4" strokeLinecap="round" />
                <line className="s-arm-r" x1="6" y1="-12" x2="14" y2="-5" stroke={shooterColor} strokeWidth="4" strokeLinecap="round" />
                <line className="s-leg-l" x1="-3" y1="4" x2="-7" y2="20" stroke="#f4f1e8" strokeWidth="4" strokeLinecap="round" />
                <line className="s-leg-r" x1="3" y1="4" x2="11" y2="17" stroke="#f4f1e8" strokeWidth="4" strokeLinecap="round" />
              </g>
            </g>

            {/* YOU marker */}
            {duel.status === 'active' && !animating && iAmIn && (
              <g transform={iShoot ? 'translate(122 180)' : 'translate(200 96)'}>
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
            <path ref={trailRef} d="M 200 228 Q 200 228 200 228" stroke="url(#dTrail)" strokeWidth="4" strokeLinecap="round" fill="none" opacity="0" />
            <g ref={ballRef}>
              <g ref={ballYRef}>
                <g transform="translate(200 228)">
                  <ellipse cx="2" cy="9" rx="10" ry="3" fill="rgba(0,0,0,0.3)" />
                  <g ref={ballImgRef}>
                    {/* fallback ball shows if the PNG is missing */}
                    <circle r="11" fill="#f4f1e8" stroke="#0b3d2c" strokeWidth="0.5" />
                    <image href="/minigame_ball.png" x="-12" y="-12" width="24" height="24" preserveAspectRatio="xMidYMid meet" />
                  </g>
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
                  if (!iAmIn) return `${nameOf(duel.winner ?? '')} wins 🏆`;
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
                {iAmIn && (
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
                )}
                <button className="link-btn" onClick={() => setActiveId(null)}>
                  Back to lobby
                </button>
              </div>
            </div>
          )}
        </div>

        {duel.status === 'finished' ? null : animating ? (
          <p className="duel-status">…</p>
        ) : !iAmIn ? (
          <p className="duel-status">👀 Spectating · {nameOf(shooterId)} to shoot, kick {duel.kick}</p>
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
                  onClick={() => {
                    sfx.whistle();
                    duel.id === CPU_DUEL_ID
                      ? cpuPick(p)
                      : rpc('duel_submit_pick', { p_duel: duel.id, p_pick: p });
                  }}
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

        {/* Private edge readout — Joaquin only, his own games, real opponents only. */}
        {duel.status === 'active' && !animating && iAmIn && nameOf(me) === 'Joaquin' && keeperId !== CPU_ID && shooterId !== CPU_ID && (
          <DuelEdge
            duels={duels}
            me={me}
            oppId={duel.challenger === me ? duel.opponent : duel.challenger}
            oppName={nameOf(duel.challenger === me ? duel.opponent : duel.challenger)}
            role={iShoot ? 'shoot' : 'keep'}
            currentDuelId={duel.id}
          />
        )}

        {duel.status === 'active' && iAmIn && (
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
      <h1>Penalty Shootouts</h1>
      <p className="subtitle">
        Challenge a bro to a best-of-5 shootout. Pick in secret, reveal together. Bragging rights
        only.
      </p>
      <div className="groups-head">
        <span className="groups-title">{isGuest ? 'Practice' : 'Challenge'}</span>
        <div className="contenders-line" />
      </div>
      {isGuest && (
        <p className="page-intro" style={{ marginBottom: 12 }}>
          You&apos;re in guest mode — games don&apos;t register. Practice against the CPU anytime.
        </p>
      )}
      <div className="duel-lobby-grid">
        {!isGuest && others.map((p) => {
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

      {!isGuest && (pending.length > 0 || active.length > 0) && (
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
                <span className="duel-row-actions">
                  <span className="duel-waiting">waiting…</span>
                  <button
                    className="link-btn"
                    disabled={busy}
                    onClick={() => rpc('duel_cancel', { p_duel: d.id })}
                  >
                    Cancel
                  </button>
                </span>
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

      {!isGuest && othersActive.length > 0 && (
        <>
          <div className="groups-head">
            <span className="groups-title">Live now</span>
            <div className="contenders-line" />
          </div>
          {othersActive.map((d) => (
            <div className="duel-row" key={d.id}>
              <span>
                {nameOf(d.challenger)} {d.challenger_score} – {d.opponent_score} {nameOf(d.opponent)}
              </span>
              <span className="duel-row-actions">
                <button className="save-btn" onClick={() => setActiveId(d.id)}>
                  👀 Spectate
                </button>
              </span>
            </div>
          ))}
        </>
      )}

      {!isGuest && allFinished.length > 0 && (
        <>
          <div className="groups-head">
            <span className="groups-title">History</span>
            <div className="contenders-line" />
          </div>
          <div style={{ maxHeight: 420, overflowY: 'auto' }}>
            {allFinished.map((d) => {
              const cMeta = metaOf(d.challenger);
              const oMeta = metaOf(d.opponent);
              return (
                <div className="duel-row done" key={d.id}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {cMeta && <img src={flagUrl(cMeta.flagCode)!} alt="" className="heat-flag" />}
                    {nameOf(d.challenger)}
                    <span style={{ margin: '0 4px' }}>{d.challenger_score} – {d.opponent_score}</span>
                    {oMeta && <img src={flagUrl(oMeta.flagCode)!} alt="" className="heat-flag" />}
                    {nameOf(d.opponent)}
                  </span>
                  <span className="duel-winner-tag">{nameOf(d.winner ?? '')} 🏆</span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {msg && <p className="msg-err">{msg}</p>}
    </div>
  );
}
