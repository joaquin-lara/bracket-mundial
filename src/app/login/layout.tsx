import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Log in',
  // Explicit so Add-to-Home-Screen from the login page also gets the ball icon.
  icons: { icon: '/icon-192.png', apple: '/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'Stonks Bracket', statusBarStyle: 'black-translucent' },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
