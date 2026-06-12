'use client';

import { geoDistance, geoOrthographic, geoPath } from 'd3-geo';
import { useEffect, useRef } from 'react';
import { feature, mesh } from 'topojson-client';
import worldData from 'world-atlas/countries-110m.json';
import type { Match } from '@/lib/types';

// 2026 host cities (lat, lon). Today's matches are assigned one each in
// order (the free API doesn't expose venues, so the city pick rotates, but
// every dot sits at a real stadium city and spins with the globe).
const CITIES: [string, number, number][] = [
  ['Mexico City', 19.3, -99.2],
  ['Guadalajara', 20.7, -103.3],
  ['Monterrey', 25.7, -100.3],
  ['Dallas', 32.7, -97.1],
  ['Houston', 29.7, -95.4],
  ['Kansas City', 39.0, -94.5],
  ['Atlanta', 33.8, -84.4],
  ['Miami', 25.9, -80.2],
  ['New York/NJ', 40.8, -74.1],
  ['Philadelphia', 39.9, -75.2],
  ['Boston', 42.1, -71.3],
  ['Toronto', 43.7, -79.4],
  ['Los Angeles', 33.9, -118.3],
  ['SF Bay Area', 37.4, -121.9],
  ['Seattle', 47.6, -122.3],
  ['Vancouver', 49.3, -123.1],
];

const CX = 300;
const CY = 300;
const R = 260;
const TILT = -18; // centers the view a bit north, on the host region
const FULL_SPIN_MS = 60000;
const START_LON = 95; // begin facing the Americas

// Module-level singletons: one globe per page.
/* eslint-disable @typescript-eslint/no-explicit-any */
const world = worldData as any;
const LAND = feature(world, world.objects.land);
const BORDERS = mesh(world, world.objects.countries, (a: any, b: any) => a !== b);
const EQUATOR = {
  type: 'LineString',
  coordinates: Array.from({ length: 121 }, (_, i) => [-180 + i * 3, 0]),
};

const projection = geoOrthographic().translate([CX, CY]).scale(R).clipAngle(90);
const pathGen = geoPath(projection);

interface FrameShapes {
  land: string;
  borders: string;
  eq: string;
}

function shapesAt(lambda: number): FrameShapes {
  projection.rotate([lambda, TILT]);
  return {
    land: pathGen(LAND as any) ?? '',
    borders: pathGen(BORDERS as any) ?? '',
    eq: pathGen(EQUATOR as any) ?? '',
  };
}

function dotAt(lat: number, lon: number, lambda: number) {
  projection.rotate([lambda, TILT]);
  const pos = projection([lon, lat]) ?? [CX, CY];
  const dist = geoDistance([lon, lat], [-lambda, -TILT]);
  const opacity = dist < Math.PI / 2 ? Math.min(1, Math.cos(dist) * 2.2) : 0;
  return { x: pos[0], y: pos[1], opacity };
}

const INITIAL = shapesAt(START_LON);

/**
 * Rotating earth behind the hero: real country shapes (world-atlas 110m)
 * on an orthographic projection, spinning west-to-east, with today's games
 * pulsing at real host-city coordinates and fading around the back.
 */
export default function GlobeBackdrop({ matches }: { matches: Match[] }) {
  const landRef = useRef<SVGPathElement | null>(null);
  const bordersRef = useRef<SVGPathElement | null>(null);
  const eqRef = useRef<SVGPathElement | null>(null);
  const dotRefs = useRef<(SVGGElement | null)[]>([]);

  const count = Math.min(matches.length, CITIES.length);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    const tick = () => {
      const lambda =
        START_LON + ((performance.now() % FULL_SPIN_MS) / FULL_SPIN_MS) * 360;
      const shapes = shapesAt(lambda);
      landRef.current?.setAttribute('d', shapes.land);
      bordersRef.current?.setAttribute('d', shapes.borders);
      eqRef.current?.setAttribute('d', shapes.eq);
      dotRefs.current.forEach((el, i) => {
        if (!el) return;
        const [, lat, lon] = CITIES[i % CITIES.length];
        const p = dotAt(lat, lon, lambda);
        el.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`);
        el.setAttribute('opacity', p.opacity.toFixed(2));
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [count]);

  return (
    <div className="globe-backdrop" aria-hidden="true">
      <svg viewBox="0 0 600 600" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="globeGlow" cx="50%" cy="42%" r="60%">
            <stop offset="0%" stopColor="rgba(230,179,55,0.10)" />
            <stop offset="55%" stopColor="rgba(230,179,55,0.04)" />
            <stop offset="100%" stopColor="rgba(230,179,55,0)" />
          </radialGradient>
          <radialGradient id="sphereShade" cx="38%" cy="30%" r="78%">
            <stop offset="0%" stopColor="rgba(155, 208, 218, 0.5)" />
            <stop offset="50%" stopColor="rgba(82, 150, 168, 0.42)" />
            <stop offset="100%" stopColor="rgba(20, 62, 80, 0.6)" />
          </radialGradient>
        </defs>

        {/* halo + shaded ocean */}
        <circle cx={CX} cy={CY} r="295" fill="url(#globeGlow)" />
        <circle cx={CX} cy={CY} r={R} fill="url(#sphereShade)" />

        {/* land, borders, equator */}
        <path ref={landRef} d={INITIAL.land} className="g-land" />
        <path ref={bordersRef} d={INITIAL.borders} className="g-borders" />
        <path ref={eqRef} d={INITIAL.eq} className="g-equator" />

        {/* sphere outline */}
        <circle cx={CX} cy={CY} r={R} className="g-line g-outline" />

        {/* today's matches at host-city coordinates */}
        {matches.slice(0, count).map((m, i) => {
          const [, lat, lon] = CITIES[i % CITIES.length];
          const p = dotAt(lat, lon, START_LON);
          return (
            <g
              key={m.id}
              ref={(el) => {
                dotRefs.current[i] = el;
              }}
              transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}
              opacity={p.opacity.toFixed(2)}
            >
              <circle r="4.5" className="g-dot" style={{ animationDelay: `${i * 0.35}s` }} />
              <circle r="4.5" className="g-ping" style={{ animationDelay: `${i * 0.35}s` }} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
