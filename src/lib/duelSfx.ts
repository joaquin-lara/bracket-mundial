// Tiny Web Audio sound layer for the shootout — all synthesized, no asset files.
// Lazily creates one AudioContext (resumed on the first play, which always
// follows a user gesture). Honors a persisted mute flag.

let ctx: AudioContext | null = null;
let mutedCache: boolean | null = null;

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

export function isMuted(): boolean {
  if (mutedCache !== null) return mutedCache;
  if (typeof localStorage !== 'undefined') mutedCache = localStorage.getItem('duelMute') === '1';
  return !!mutedCache;
}
export function setMuted(m: boolean): void {
  mutedCache = m;
  if (typeof localStorage !== 'undefined') localStorage.setItem('duelMute', m ? '1' : '0');
  if (m && ctx) void ctx.suspend();
}

function tone(freq: number, t0: number, dur: number, type: OscillatorType, gain: number, slideTo?: number) {
  const a = ac();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(a.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise(t0: number, dur: number, gain: number, type: BiquadFilterType, freq: number, q = 1, ramp?: number) {
  const a = ac();
  if (!a) return;
  const n = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, n, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t0);
  if (ramp) f.frequency.exponentialRampToValueAtTime(ramp, t0 + dur);
  f.Q.value = q;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.08, dur * 0.3));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(a.destination);
  src.start(t0);
  src.stop(t0 + dur);
}

const now = () => ac()?.currentTime ?? 0;

// Play a random clip from a list of public audio files (equal probability).
const GOAL_FILES = ['/minigame_sounds/goal.mp3', '/minigame_sounds/goal2.mp3', '/minigame_sounds/goal3.mp3'];
function playRandomFile(files: string[], volume = 0.2) {
  if (isMuted() || typeof Audio === 'undefined' || files.length === 0) return;
  const src = files[Math.floor(Math.random() * files.length)];
  try {
    const a = new Audio(src);
    a.volume = volume;
    a.play().catch(() => {});
  } catch {
    /* ignore */
  }
}

export const sfx = {
  whistle() {
    if (isMuted() || typeof Audio === 'undefined') return;
    try {
      const a = new Audio('/minigame_sounds/whistle.mp3');
      a.volume = 0.8;
      a.play().catch(() => {});
    } catch { /* ignore */ }
  },
  kick() {
    if (isMuted()) return;
    const t = now();
    tone(150, t, 0.14, 'sine', 0.5, 60);
    noise(t, 0.06, 0.35, 'lowpass', 1800);
  },
  whoosh() {
    if (isMuted()) return;
    noise(now(), 0.34, 0.12, 'bandpass', 700, 1.4, 2600);
  },
  goal() {
    // One of the three real goal clips, chosen at random with equal odds.
    playRandomFile(GOAL_FILES, 0.58);
  },
  save() {
    if (isMuted()) return;
    const t = now();
    tone(120, t, 0.12, 'sine', 0.4, 70); // glove thud
    noise(t + 0.04, 0.7, 0.28, 'lowpass', 380); // crowd "ooh"
  },
  win() {
    if (isMuted()) return;
    const t = now();
    [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, t + i * 0.1, 0.45, 'triangle', 0.18));
    noise(t, 1.6, 0.5, 'lowpass', 600, 1, 1500);
  },
};
