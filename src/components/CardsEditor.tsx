'use client';

import { useState, useTransition } from 'react';
import { saveDiscipline, type DisciplineInput } from '@/app/actions';
import Flag from './Flag';
import { fairPlayPoints } from '@/lib/fairPlay';

export interface CardsRow {
  code: string;
  name: string;
  yellow: number;
  second_yellow: number;
  direct_red: number;
  yellow_direct_red: number;
}

type Field = 'yellow' | 'second_yellow' | 'direct_red' | 'yellow_direct_red';
const FIELDS: { key: Field; label: string }[] = [
  { key: 'yellow', label: 'Yellow' },
  { key: 'second_yellow', label: '2nd yellow' },
  { key: 'direct_red', label: 'Direct red' },
  { key: 'yellow_direct_red', label: 'Yellow + red' },
];

function points(r: CardsRow): number {
  return fairPlayPoints({
    yellow: r.yellow,
    secondYellow: r.second_yellow,
    directRed: r.direct_red,
    yellowAndDirectRed: r.yellow_direct_red,
  });
}

export default function CardsEditor({ initial }: { initial: CardsRow[] }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<CardsRow[]>(initial);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const update = (code: string, field: Field, value: string) => {
    const n = Math.max(0, Math.min(99, Math.floor(Number(value) || 0)));
    setRows((rs) => rs.map((r) => (r.code === code ? { ...r, [field]: n } : r)));
    setMsg(null);
  };

  const save = () => {
    setMsg(null);
    startTransition(async () => {
      const payload: DisciplineInput[] = rows.map((r) => ({
        team_code: r.code,
        yellow: r.yellow,
        second_yellow: r.second_yellow,
        direct_red: r.direct_red,
        yellow_direct_red: r.yellow_direct_red,
      }));
      const res = await saveDiscipline(payload);
      setMsg(res.ok ? { ok: true, text: 'Saved.' } : { ok: false, text: res.error ?? 'Save failed.' });
    });
  };

  return (
    <div className="cards-editor">
      <div className="groups-head">
        <span className="groups-title">Card Tracker</span>
        <div className="contenders-line" />
        <button
          className={`projected-toggle${open ? ' active' : ''}`}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Hide tracker' : 'Open tracker'}
        </button>
      </div>
      {!open && (
        <p className="subtitle">
          Enter each team&apos;s group-stage cards to factor fair-play into the group tables.
        </p>
      )}
      {open && (
        <>
          <div className="cards-table-wrap">
            <table className="cards-table">
              <thead>
                <tr>
                  <th className="ce-team">Team</th>
                  {FIELDS.map((f) => (
                    <th key={f.key}>{f.label}</th>
                  ))}
                  <th title="FIFA fair-play points">FP</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.code}>
                    <td className="ce-team">
                      <Flag code={r.code} name={r.name} />
                      <span className="ce-name">{r.name}</span>
                    </td>
                    {FIELDS.map((f) => (
                      <td key={f.key}>
                        <input
                          type="number"
                          min={0}
                          max={99}
                          inputMode="numeric"
                          value={r[f.key] || ''}
                          onChange={(e) => update(r.code, f.key, e.target.value)}
                          aria-label={`${r.name} ${f.label}`}
                        />
                      </td>
                    ))}
                    <td className="ce-fp">{points(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="cards-actions">
            <button type="button" onClick={save} disabled={pending}>
              {pending ? 'Saving…' : 'Save card counts'}
            </button>
            {msg && <span className={`cards-msg${msg.ok ? ' ok' : ' err'}`}>{msg.text}</span>}
          </div>
        </>
      )}
    </div>
  );
}
