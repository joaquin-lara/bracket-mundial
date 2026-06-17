'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Flag from './Flag';
import { TEAMS, byCode } from '@/lib/ml/teams';

function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Type-to-search team picker: shows the selected team with its flag, and on focus
 * lets you filter the 48 teams by typing instead of scrolling a long <select>.
 */
export default function TeamCombobox({
  value,
  onChange,
  exclude,
  label,
}: {
  value: string;
  onChange: (code: string) => void;
  exclude?: string;
  label: string;
}) {
  const selected = byCode(value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hi, setHi] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const q = norm(query.trim());
    return TEAMS.filter((t) => t.code !== exclude && (q === '' || norm(t.name).includes(q) || norm(t.code).includes(q)));
  }, [query, exclude]);

  // Close when clicking outside.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (code: string) => {
    onChange(code);
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { setOpen(true); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (matches[hi]) pick(matches[hi].code); }
    else if (e.key === 'Escape') { setOpen(false); setQuery(''); }
  };

  return (
    <div className="ml-combo" ref={wrapRef}>
      <div className="ml-select-wrap">
        <Flag code={selected?.code ?? null} name={selected?.name} />
        <input
          ref={inputRef}
          className="ml-combo-input"
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-label={label}
          value={open ? query : selected?.name ?? ''}
          placeholder="Type a team…"
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setHi(0); }}
          onFocus={() => { setOpen(true); setQuery(''); setHi(0); }}
          onKeyDown={onKeyDown}
        />
        <span className="ml-combo-caret" aria-hidden>▾</span>
      </div>

      {open && (
        <ul className="ml-combo-list" role="listbox">
          {matches.length === 0 && <li className="ml-combo-empty">No teams match “{query}”.</li>}
          {matches.map((t, i) => (
            <li
              key={t.code}
              role="option"
              aria-selected={t.code === value}
              className={`ml-combo-opt${i === hi ? ' hi' : ''}${t.code === value ? ' sel' : ''}`}
              onMouseEnter={() => setHi(i)}
              onMouseDown={(e) => { e.preventDefault(); pick(t.code); }}
            >
              <Flag code={t.code} name={t.name} />
              <span>{t.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
