import Flag from './Flag';
import type { GroupRow, GroupTable } from '@/lib/groups';
import {
  groupLetter,
  groupOutlooks,
  rankThirds,
  type QualStatus,
  type TeamOutlook,
} from '@/lib/qualification';
import type { Match } from '@/lib/types';

const STATUS_LABEL: Record<QualStatus, string> = {
  won_group: '1st',
  through: 'Qualified',
  in_contention: 'In contention',
  third_race: '3rd-place race',
  eliminated: 'Out',
};

function StatusPill({ status }: { status: QualStatus }) {
  return <span className={`ais-pill ais-${status}`}>{STATUS_LABEL[status]}</span>;
}

function GroupOutlookCard({ table, outlooks }: { table: GroupTable; outlooks: TeamOutlook[] }) {
  const byTeam = new Map(table.rows.map((r) => [r.team, r]));
  return (
    <div className="group-card ais-card">
      <div className="group-name">{table.name}</div>
      <ul className="ais-teams">
        {outlooks.map((o) => {
          const row = byTeam.get(o.team);
          return (
            <li key={o.team} className="ais-team">
              <div className="ais-team-top">
                <Flag code={o.code} name={o.team} />
                <span className="ais-team-name">{o.team}</span>
                <span className="ais-pts">{row?.pts ?? 0} pts</span>
                <StatusPill status={o.status} />
              </div>
              <p className="ais-note">{o.note}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface SummaryRow {
  label: string; // "1A", "2A", "3A"
  row: GroupRow;
  className: string;
}

function SummaryTable({ rows, colHeader }: { rows: SummaryRow[]; colHeader: string }) {
  return (
    <table className="group-table">
      <thead>
        <tr>
          <th className="gt-team">Team</th>
          <th title="Group placement">{colHeader}</th>
          <th title="Points">Pts</th>
          <th title="Goal difference">GD</th>
          <th className="gt-wide" title="Goals for">GF</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className={r.className}>
            <td className="gt-team">
              <Flag code={r.row.code} name={r.row.team} />
              <span className="gt-name">{r.row.team}</span>
            </td>
            <td>{r.label}</td>
            <td className="gt-pts">{r.row.pts}</td>
            <td>{r.row.gd > 0 ? `+${r.row.gd}` : r.row.gd}</td>
            <td className="gt-wide">{r.row.gf}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function AsItStands({
  tables,
  matches,
}: {
  tables: GroupTable[];
  matches: Match[];
}) {
  if (tables.length === 0) return null;

  const thirds = rankThirds(tables);

  const qualifiers: SummaryRow[] = tables.flatMap((t) => {
    const g = groupLetter(t.name);
    const out: SummaryRow[] = [];
    if (t.rows[0]) out.push({ label: `1${g}`, row: t.rows[0], className: 'qualify' });
    if (t.rows[1]) out.push({ label: `2${g}`, row: t.rows[1], className: 'qualify' });
    return out;
  });
  const thirdRows: SummaryRow[] = thirds.map((t, i) => ({
    label: `3${t.group}`,
    row: t.row,
    className: t.qualifies ? 'qualify' : i === 8 ? 'maybe' : '',
  }));

  return (
    <section className="ais-section">
      <div className="groups-head">
        <span className="groups-title">As It Stands</span>
        <div className="contenders-line" />
      </div>
      <p className="subtitle">
        A live projection from the results so far — current placings, what the teams on the
        bubble still need, and the Round of 32 these standings would produce. Updates as games
        finish; replaced by the real draw once the knockouts are set.
      </p>

      <div className="groups-grid">
        {tables.map((t) => (
          <GroupOutlookCard key={t.name} table={t} outlooks={groupOutlooks(t, matches)} />
        ))}
      </div>

      <div className="groups-head">
        <span className="groups-title">Placement Summary</span>
        <div className="contenders-line" />
      </div>
      <p className="subtitle">
        Where every team sits if the group stage ended now. Group winners (1) and runners-up (2)
        all advance; the eight best third-placed teams (gold) join them.
      </p>
      <div className="ais-summary">
        <div className="ais-summary-table">
          <p className="ais-table-label">Group 1st and 2nd places</p>
          <div className="ais-table-scroll">
            <SummaryTable rows={qualifiers} colHeader="Pos" />
          </div>
        </div>
        <div className="ais-summary-table">
          <p className="ais-table-label">Best third-placed teams</p>
          <SummaryTable rows={thirdRows} colHeader="Pos" />
        </div>
      </div>

    </section>
  );
}
