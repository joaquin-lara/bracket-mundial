import { flagUrl } from '@/lib/flags';
import { PLAYER_META, type Player } from '@/lib/players';

export interface HeatColumn {
  id: number;
  title: string; // e.g. "MEX 2–0 RSA · Jun 11"
}

export interface HeatRow {
  name: string;
  cells: (number | null)[]; // points per finished match; null = no pick
}

/** One square per finished game per player: the form wall. */
export default function PickHeatmap({ columns, rows }: { columns: HeatColumn[]; rows: HeatRow[] }) {
  if (columns.length === 0 || rows.length === 0) return null;

  return (
    <div className="heat-card">
      <div className="race-title">Pick wall</div>
      <p className="heat-sub">One square per finished game, oldest first. Hover for the match.</p>

      {rows.map((r) => {
        const meta = PLAYER_META[r.name as Player];
        return (
          <div className="heat-row" key={r.name}>
            <span className="heat-name">
              {meta && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={flagUrl(meta.flagCode)!} alt="" className="heat-flag" />
              )}
              {r.name}
            </span>
            <span className="heat-cells">
              {r.cells.map((c, i) => (
                <span
                  key={columns[i].id}
                  className={`heat-cell hc-${c ?? 'none'}`}
                  title={`${columns[i].title} — ${c ?? 0} pts`}
                />
              ))}
            </span>
          </div>
        );
      })}

      <div className="heat-legend">
        <span>
          <i className="heat-cell hc-3" /> 3 exact
        </span>
        <span>
          <i className="heat-cell hc-2" /> 2 outcome
        </span>
        <span>
          <i className="heat-cell hc-1" /> 1 wrong
        </span>
        <span>
          <i className="heat-cell hc-none" /> 0 no pick
        </span>
      </div>
    </div>
  );
}
