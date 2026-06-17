import { lookupVenue } from '@/lib/venues';

const ROOF_LABEL = { open: 'Open air', fixed: 'Indoor', retractable: 'Retractable roof' } as const;

/**
 * Host-stadium detail for a match: stadium, city, capacity and roof. Renders the
 * raw venue string as a fallback when the fixture isn't at a recognised 2026
 * host, and nothing at all when blank.
 */
export default function VenueInfo({ venue }: { venue: string | null }) {
  const v = lookupVenue(venue);
  if (!v) return venue ? <div className="venue-info venue-info-plain">🏟 {venue}</div> : null;

  return (
    <div className="venue-info">
      <div className="venue-head">
        <span className="venue-stadium">🏟 {v.stadium}</span>
        <span className="venue-city">{v.city}</span>
      </div>
      <div className="venue-facts">
        <span>👥 {v.capacity.toLocaleString()}</span>
        <span>{ROOF_LABEL[v.roof]}</span>
        {v.elevationM >= 500 && <span>⛰ {v.elevationM.toLocaleString()} m</span>}
      </div>
    </div>
  );
}
