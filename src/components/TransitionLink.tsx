'use client';

import Link from 'next/link';
import type { ComponentProps } from 'react';
import { usePageTransition } from './PageTransition';

type Props = Omit<ComponentProps<typeof Link>, 'href'> & { href: string };

export default function TransitionLink({ href, onClick, children, ...props }: Props) {
  const { navigate } = usePageTransition();

  return (
    <Link
      href={href}
      {...props}
      onClick={(e) => {
        onClick?.(e as React.MouseEvent<HTMLAnchorElement>);
        if (e.defaultPrevented) return;
        // Let modifier+clicks (open in new tab etc.) pass through normally
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </Link>
  );
}
