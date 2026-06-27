'use client';

import { useState, type ReactNode } from 'react';

/**
 * A section whose body collapses behind its `groups-head` title. Collapsed by
 * default so the knockout bracket stays front-and-center; the toggle reuses the
 * shared `.projected-toggle` button styling.
 */
export default function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <>
      <div className="groups-head">
        <span className="groups-title">{title}</span>
        <div className="contenders-line" />
        <button
          className={`projected-toggle${open ? ' active' : ''}`}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      {open && children}
    </>
  );
}
