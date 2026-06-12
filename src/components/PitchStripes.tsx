'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export default function PitchStripes() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;
  return createPortal(<div className="pitch-stripes" aria-hidden="true" />, document.body);
}
