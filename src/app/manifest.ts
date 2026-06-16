import type { MetadataRoute } from 'next';

// Web app manifest -- makes the site an installable PWA so iOS (16.4+) can deliver
// Web Push from the home-screen app. Served at /manifest.webmanifest.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Stonks Bracket',
    short_name: 'Stonks',
    description: 'World Cup 2026 prediction game',
    start_url: '/',
    display: 'standalone',
    background_color: '#0b5f3a',
    theme_color: '#0b5f3a',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
