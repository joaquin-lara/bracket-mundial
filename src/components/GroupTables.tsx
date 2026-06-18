import Flag from './Flag';
import type { GroupTable } from '@/lib/groups';

/** The 12 group-stage tables: top 2 qualify (gold), 3rd might (dashed). */
export default function GroupTables({ tables }: { tables: GroupTable[] }) {
  if (tables.length === 0) return null;

  return (
    <section className="groups-section">
      <div className="groups-head">
        <span className="groups-title">Group Stage</span>
        <div className="contenders-line" />
      </div>
      <p className="subtitle">
        Top 2 of each group qualify (gold). The 8 best third-placed teams also make it.
      </p>
      <p className="groups-key">
        <strong>P</strong> played · <strong>W</strong> won · <strong>D</strong> drawn ·{' '}
        <strong>L</strong> lost · <strong>GF</strong> goals for · <strong>GA</strong> goals
        against · <strong>GD</strong> goal difference · <strong>Pts</strong> points
      </p>
      <p className="groups-key">
        Teams earn <strong>3</strong> points for a win, <strong>1</strong> for a draw,{' '}
        <strong>0</strong> for a loss. Ties break first on the head-to-head record between the
        level teams, then overall goal difference, goals scored, fair play, and FIFA ranking.
      </p>
      <div className="groups-grid">
        {tables.map((t) => (
          <div className="group-card" key={t.name}>
            <div className="group-name">{t.name}</div>
            <table className="group-table">
              <thead>
                <tr>
                  <th className="gt-team">Team</th>
                  <th title="Played">P</th>
                  <th className="gt-wide" title="Won">
                    W
                  </th>
                  <th className="gt-wide" title="Drawn">
                    D
                  </th>
                  <th className="gt-wide" title="Lost">
                    L
                  </th>
                  <th className="gt-wide" title="Goals for">
                    GF
                  </th>
                  <th className="gt-wide" title="Goals against">
                    GA
                  </th>
                  <th title="Goal difference">GD</th>
                  <th className="gt-pts" title="Points: 3 a win, 1 a draw">
                    Pts
                  </th>
                </tr>
              </thead>
              <tbody>
                {t.rows.map((r, i) => (
                  <tr key={r.team} className={i < 2 ? 'qualify' : i === 2 ? 'maybe' : ''}>
                    <td className="gt-team">
                      <Flag code={r.code} name={r.team} />
                      <span className="gt-name">{r.team}</span>
                    </td>
                    <td>{r.played}</td>
                    <td className="gt-wide">{r.won}</td>
                    <td className="gt-wide">{r.drawn}</td>
                    <td className="gt-wide">{r.lost}</td>
                    <td className="gt-wide">{r.gf}</td>
                    <td className="gt-wide">{r.ga}</td>
                    <td>{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
                    <td className="gt-pts">{r.pts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </section>
  );
}
