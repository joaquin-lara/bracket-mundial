'use client';

import { geoDistance, geoOrthographic, geoPath } from 'd3-geo';
import gsap from 'gsap';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { feature, mesh } from 'topojson-client';
import worldData from 'world-atlas/countries-110m.json';
import type { Match } from '@/lib/types';

// 2026 host cities (lat, lon). Today's matches are assigned one each in
// order (the free API doesn't expose venues, so the city pick rotates, but
// every dot sits at a real stadium city).
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
// Fallback view center when no games today: middle of the host region.
const FALLBACK: [number, number] = [33, -98]; // lat, lon

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

/**
 * Static earth behind the hero: real country shapes (world-atlas 110m) on an
 * orthographic projection, centered on the average location of today's match
 * cities. Today's games pulse in gold at real host-city coordinates.
 */
export default function GlobeBackdrop({ matches }: { matches: Match[] }) {
  const [mounted, setMounted] = useState(false);
  const innerRef = useRef<HTMLDivElement>(null);
  const landRef = useRef<SVGPathElement>(null);
  const bordersRef = useRef<SVGPathElement>(null);
  const eqRef = useRef<SVGPathElement>(null);
  const dotsRef = useRef<SVGGElement>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;

    gsap.set(el, { scale: 0.1, y: -window.innerHeight * 1.6 });

    const rotProxy = { lon: centerLon };
    const tl = gsap.timeline({ delay: 0.15 });

    const updateGlobe = () => {
      projection.rotate([-rotProxy.lon, -centerLat]);
      landRef.current?.setAttribute('d', pathGen(LAND as any) ?? '');
      bordersRef.current?.setAttribute('d', pathGen(BORDERS as any) ?? '');
      eqRef.current?.setAttribute('d', pathGen(EQUATOR as any) ?? '');
      const groups = dotsRef.current?.children;
      if (groups) {
        Array.from(groups).forEach((g, i) => {
          const [, lat, lon] = CITIES[i % CITIES.length];
          const pos = projection([lon, lat]) ?? [CX, CY];
          const dist = geoDistance([lon, lat], [rotProxy.lon, centerLat]);
          const opacity = dist < Math.PI / 2 ? Math.min(1, Math.cos(dist) * 2.2) : 0;
          g.setAttribute('transform', `translate(${pos[0].toFixed(1)} ${pos[1].toFixed(1)})`);
          g.setAttribute('opacity', opacity.toFixed(2));
        });
      }
    };

    tl.to(el, {
      y: 0,
      duration: 1.1,
      ease: 'power3.out',
    })
    .to(el, {
      scale: 1,
      duration: 2.0,
      ease: 'power2.inOut',
    })
    .to(rotProxy, {
      lon: centerLon - 360,
      duration: 2.2,
      ease: 'power3.inOut',
      onUpdate: updateGlobe,
    }, '<-0.2');

    return () => { tl.kill(); };
  }, [mounted]);

  const localToday = new Date().toLocaleDateString('en-CA');
  const todayMatches = matches.filter(
    (m) => new Date(m.kickoff).toLocaleDateString('en-CA') === localToday
  );
  const count = Math.min(todayMatches.length, CITIES.length);
  const used = CITIES.slice(0, count);

  const centerLat = used.length ? used.reduce((s, c) => s + c[1], 0) / used.length : FALLBACK[0];
  const centerLon = used.length ? used.reduce((s, c) => s + c[2], 0) / used.length : FALLBACK[1];


  projection.rotate([-centerLon, -centerLat]);

  const shapes = {
    land: pathGen(LAND as any) ?? '',
    borders: pathGen(BORDERS as any) ?? '',
    eq: pathGen(EQUATOR as any) ?? '',
  };

  const dots = todayMatches.slice(0, count).map((m, i) => {
    const [, lat, lon] = CITIES[i % CITIES.length];
    const pos = projection([lon, lat]) ?? [CX, CY];
    const dist = geoDistance([lon, lat], [centerLon, centerLat]);
    const opacity = dist < Math.PI / 2 ? Math.min(1, Math.cos(dist) * 2.2) : 0;
    return { id: m.id, x: pos[0], y: pos[1], opacity };
  });

  const content = (
    <div className="globe-backdrop" aria-hidden="true">
      <div ref={innerRef} className="globe-inner">
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

        {/* opaque base blocks stripes from bleeding through the ocean */}
        <circle cx={CX} cy={CY} r={R} fill="var(--bg-dark)" />

        {/* halo + shaded ocean */}
        <circle cx={CX} cy={CY} r="295" fill="url(#globeGlow)" />
        <circle cx={CX} cy={CY} r={R} fill="url(#sphereShade)" />

        {/* land, borders, equator */}
        <path ref={landRef} d={shapes.land} className="g-land" />
        <path ref={bordersRef} d={shapes.borders} className="g-borders" />
        <path ref={eqRef} d={shapes.eq} className="g-equator" />

        {/* sphere outline */}
        <circle cx={CX} cy={CY} r={R} className="g-line g-outline" />

        {/* today's matches at host-city coordinates */}
        <g ref={dotsRef}>
        {dots.map((d, i) => (
          <g key={d.id} transform={`translate(${d.x.toFixed(1)} ${d.y.toFixed(1)})`} opacity={d.opacity.toFixed(2)}>
            <circle r="4.5" className="g-dot" style={{ animationDelay: `${i * 0.35}s` }} />
            <circle r="4.5" className="g-ping" style={{ animationDelay: `${i * 0.35}s` }} />
          </g>
        ))}
        </g>
      </svg>
      </div>
    </div>
  );

  return mounted ? createPortal(content, document.body) : null;
}
