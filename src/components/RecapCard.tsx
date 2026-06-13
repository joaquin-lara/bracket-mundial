import type { Recap } from '@/lib/recap';

/** Once-a-day summary of the latest completed match day. */
export default function RecapCard({ recap }: { recap: Recap | null }) {
  if (!recap) return null;
  return (
    <div className="recap-card">
      <div className="recap-head">
        <span className="recap-title">Match-day recap</span>
        <span className="recap-day">{recap.dayLabel}</span>
      </div>
      {recap.lines.map((l, i) => (
        <div className="recap-line" key={i}>
          <span className="recap-icon">{l.icon}</span>
          <span>{l.text}</span>
        </div>
      ))}
    </div>
  );
}
