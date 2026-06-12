import type { Match } from '@/lib/types';

// Stylized anchor points on the upper-left face of the globe (the host
// region, roughly). Today's matches land on these, one dot each.
const ANCHORS: [number, number][] = [
  [200, 170],
  [248, 152],
  [292, 168],
  [222, 206],
  [268, 196],
  [310, 188],
  [188, 238],
  [244, 240],
  [300, 230],
  [214, 272],
  [274, 266],
  [324, 254],
];

/** Decorative wireframe globe behind the hero; today's games pulse in gold. */
export default function GlobeBackdrop({ matches }: { matches: Match[] }) {
  return (
    <div className="globe-backdrop" aria-hidden="true">
      <svg viewBox="0 0 600 600" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="globeGlow" cx="50%" cy="42%" r="60%">
            <stop offset="0%" stopColor="rgba(230,179,55,0.10)" />
            <stop offset="55%" stopColor="rgba(230,179,55,0.04)" />
            <stop offset="100%" stopColor="rgba(230,179,55,0)" />
          </radialGradient>
        </defs>

        <circle cx="300" cy="300" r="295" fill="url(#globeGlow)" />

        {/* sphere outline */}
        <circle cx="300" cy="300" r="260" className="g-line g-outline" />

        {/* meridians */}
        <line x1="300" y1="40" x2="300" y2="560" className="g-line" />
        <ellipse cx="300" cy="300" rx="87" ry="260" className="g-line" />
        <ellipse cx="300" cy="300" rx="173" ry="260" className="g-line" />

        {/* parallels */}
        <ellipse cx="300" cy="300" rx="260" ry="87" className="g-line" />
        <ellipse cx="300" cy="300" rx="260" ry="173" className="g-line" />

        {/* equator, slowly drifting */}
        <line x1="40" y1="300" x2="560" y2="300" className="g-equator" />

        {/* today's matches */}
        {matches.slice(0, ANCHORS.length).map((m, i) => {
          const [x, y] = ANCHORS[i % ANCHORS.length];
          return (
            <g key={m.id} transform={`translate(${x} ${y})`}>
              <circle r="4.5" className="g-dot" style={{ animationDelay: `${i * 0.35}s` }} />
              <circle r="4.5" className="g-ping" style={{ animationDelay: `${i * 0.35}s` }} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
