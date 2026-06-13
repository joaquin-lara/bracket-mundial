'use client';

import gsap from 'gsap';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useRef } from 'react';

const Ctx = createContext<{ navigate: (href: string) => void }>({ navigate: () => {} });

export function usePageTransition() {
  return useContext(Ctx);
}

const BALL_PX = 300;

export default function PageTransitionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const panelRef    = useRef<HTMLDivElement>(null);
  const ballWrapRef = useRef<HTMLDivElement>(null);
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const labelRef    = useRef<HTMLDivElement>(null);

  const modelRef      = useRef<THREE.Group | null>(null);
  const spinProxy     = useRef({ speed: 0 });
  const busy          = useRef(false);
  const seenPath      = useRef(pathname);
  const coverDone     = useRef(false);
  const pendingReveal = useRef(false);

  // Refs so navigate/playReveal (defined after the effect) can control the loop
  const startRender = useRef<() => void>(() => {});
  const stopRender  = useRef<() => void>(() => {});

  // ── Three.js ball — loop only runs during transitions ─────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    gsap.ticker.lagSmoothing(0);

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(1);
    renderer.setSize(BALL_PX, BALL_PX, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    cam.position.z = 3;

    scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 2.5);
    sun.position.set(3, 4, 5);
    scene.add(sun);

    new GLTFLoader().load('/Trionda%202026.glb', (gltf) => {
      const model = gltf.scene;
      const box   = new THREE.Box3().setFromObject(model);
      const cent  = box.getCenter(new THREE.Vector3());
      const size  = box.getSize(new THREE.Vector3());
      model.position.sub(cent);
      model.scale.multiplyScalar(1.733 / Math.max(size.x, size.y, size.z));
      const maxA = renderer.capabilities.getMaxAnisotropy();
      model.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => {
          const mat = m as THREE.MeshStandardMaterial;
          if (mat.map) { mat.map.anisotropy = maxA; mat.map.needsUpdate = true; }
        });
      });
      scene.add(model);
      modelRef.current = model;
    });

    let rafId: number;
    let running = false;

    startRender.current = () => {
      if (running) return;
      running = true;
      const tick = () => {
        if (!running) return;
        if (modelRef.current) modelRef.current.rotation.y += spinProxy.current.speed;
        renderer.render(scene, cam);
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    };

    stopRender.current = () => {
      running = false;
      cancelAnimationFrame(rafId);
    };

    return () => {
      running = false;
      cancelAnimationFrame(rafId);
      renderer.dispose();
    };
  }, []);

  // ── Reveal: slide everything out once the new page renders ────────────────
  const playReveal = useCallback(() => {
    const panel    = panelRef.current;
    const ballWrap = ballWrapRef.current;
    const label    = labelRef.current;

    gsap.timeline()
      .to(label,             { opacity: 0, duration: 0.15 })
      .to(ballWrap,          { x: window.innerWidth, duration: 1.1, ease: 'power2.in' }, '<0.05')
      .to(panel,             { x: '100%', duration: 0.4, ease: 'power2.inOut' })
      .call(() => {
        stopRender.current();
        busy.current = false;
        gsap.set(ballWrap, { x: -window.innerWidth });
        gsap.set(label,    { opacity: 0 });
        spinProxy.current.speed = 0;
      });
  }, []);

  useEffect(() => {
    if (pathname === seenPath.current) return;
    seenPath.current = pathname;
    if (!coverDone.current) {
      pendingReveal.current = true;
    } else {
      requestAnimationFrame(playReveal);
    }
  }, [pathname, playReveal]);

  // ── Navigate: cover screen, spin ball, hand off to router ─────────────────
  const navigate = useCallback((href: string) => {
    if (busy.current) return;
    if (href === window.location.pathname) return;

    const panel    = panelRef.current;
    const ballWrap = ballWrapRef.current;
    const label    = labelRef.current;
    if (!panel) { router.push(href); return; }

    busy.current          = true;
    coverDone.current     = false;
    pendingReveal.current = false;
    spinProxy.current.speed = 0;

    gsap.set(ballWrap, { x: -window.innerWidth });
    gsap.set(label,    { opacity: 0 });

    startRender.current();

    gsap.timeline()
      .fromTo(panel, { x: '-100%' }, { x: '0%', duration: 0.4, ease: 'power2.inOut' })
      .call(() => router.push(href))
      .to(ballWrap,             { x: 0, duration: 1.1, ease: 'power2.out' }, '-=0.05')
      .to(spinProxy.current,    { speed: 0.03, duration: 1.1 }, '<')
      .to(spinProxy.current,    { speed: 0.1, duration: 0.4, ease: 'power2.in' })
      .to(label,                { opacity: 1, duration: 0.2 }, '<0.1')
      .call(() => {
        coverDone.current = true;
        if (pendingReveal.current) playReveal();
      });
  }, [router, playReveal]);

  return (
    <Ctx.Provider value={{ navigate }}>
      {children}
      <div ref={panelRef} className="page-panel" aria-hidden="true">
        <div ref={ballWrapRef} className="transition-ball-wrap">
          <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
        </div>
        <div ref={labelRef} className="transition-loading">Loading…</div>
      </div>
    </Ctx.Provider>
  );
}
