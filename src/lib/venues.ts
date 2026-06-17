// Static reference for the 16 World Cup 2026 host stadiums. The live fixtures
// carry only a free-text `venue` string (openfootball's stadium/city name, and
// FIFA renames the sponsored grounds for the tournament), so each entry lists
// the aliases we might see and we match on a normalised substring. Capacity,
// roof and elevation drive the "crowd factor" note shown on a match card.

export interface Venue {
  stadium: string; // tournament-friendly name
  city: string;
  country: 'USA' | 'Mexico' | 'Canada';
  capacity: number;
  roof: 'open' | 'fixed' | 'retractable';
  elevationM: number;
  /** Aliases (sponsor names, FIFA names, city) we may see in the fixtures feed. */
  aliases: string[];
}

export const VENUES: Venue[] = [
  { stadium: 'Mercedes-Benz Stadium', city: 'Atlanta', country: 'USA', capacity: 71000, roof: 'retractable', elevationM: 320, aliases: ['atlanta', 'mercedes-benz', 'mercedes benz'] },
  { stadium: 'Gillette Stadium', city: 'Boston', country: 'USA', capacity: 65878, roof: 'open', elevationM: 28, aliases: ['boston', 'foxborough', 'gillette'] },
  { stadium: 'AT&T Stadium', city: 'Dallas', country: 'USA', capacity: 80000, roof: 'retractable', elevationM: 167, aliases: ['dallas', 'arlington', 'at&t', 'att stadium'] },
  { stadium: 'NRG Stadium', city: 'Houston', country: 'USA', capacity: 72220, roof: 'retractable', elevationM: 12, aliases: ['houston', 'nrg'] },
  { stadium: 'Arrowhead Stadium', city: 'Kansas City', country: 'USA', capacity: 76416, roof: 'open', elevationM: 270, aliases: ['kansas city', 'kansas', 'arrowhead'] },
  { stadium: 'SoFi Stadium', city: 'Los Angeles', country: 'USA', capacity: 70240, roof: 'fixed', elevationM: 30, aliases: ['los angeles', 'inglewood', 'sofi'] },
  { stadium: 'Hard Rock Stadium', city: 'Miami', country: 'USA', capacity: 65326, roof: 'open', elevationM: 2, aliases: ['miami', 'miami gardens', 'hard rock'] },
  { stadium: 'MetLife Stadium', city: 'New York / New Jersey', country: 'USA', capacity: 82500, roof: 'open', elevationM: 7, aliases: ['new york', 'new jersey', 'east rutherford', 'metlife'] },
  { stadium: 'Lincoln Financial Field', city: 'Philadelphia', country: 'USA', capacity: 69176, roof: 'open', elevationM: 12, aliases: ['philadelphia', 'lincoln financial'] },
  { stadium: "Levi's Stadium", city: 'San Francisco Bay Area', country: 'USA', capacity: 68500, roof: 'open', elevationM: 4, aliases: ['san francisco', 'santa clara', 'bay area', 'levi'] },
  { stadium: 'Lumen Field', city: 'Seattle', country: 'USA', capacity: 69000, roof: 'open', elevationM: 5, aliases: ['seattle', 'lumen'] },
  { stadium: 'Estadio Akron', city: 'Guadalajara', country: 'Mexico', capacity: 48071, roof: 'open', elevationM: 1566, aliases: ['guadalajara', 'akron', 'zapopan'] },
  { stadium: 'Estadio Azteca', city: 'Mexico City', country: 'Mexico', capacity: 87523, roof: 'open', elevationM: 2240, aliases: ['mexico city', 'ciudad de mexico', 'azteca', 'banorte'] },
  { stadium: 'Estadio BBVA', city: 'Monterrey', country: 'Mexico', capacity: 53500, roof: 'open', elevationM: 537, aliases: ['monterrey', 'bbva', 'guadalupe'] },
  { stadium: 'BMO Field', city: 'Toronto', country: 'Canada', capacity: 45000, roof: 'open', elevationM: 76, aliases: ['toronto', 'bmo'] },
  { stadium: 'BC Place', city: 'Vancouver', country: 'Canada', capacity: 54500, roof: 'retractable', elevationM: 3, aliases: ['vancouver', 'bc place'] },
];

function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const FLAG: Record<Venue['country'], string> = { USA: '🇺🇸', Mexico: '🇲🇽', Canada: '🇨🇦' };

/** Resolve a fixture's free-text venue string to a known host venue, or null. */
export function lookupVenue(raw: string | null | undefined): Venue | null {
  if (!raw) return null;
  const n = norm(raw);
  for (const v of VENUES) {
    if (n.includes(norm(v.stadium)) || n.includes(norm(v.city))) return v;
    if (v.aliases.some((a) => n.includes(a))) return v;
  }
  return null;
}

export function countryFlag(c: Venue['country']): string {
  return FLAG[c];
}

/** Short human note about what the venue does to the game (altitude/roof/size). */
export function venueNote(v: Venue): string {
  if (v.elevationM >= 1500) return `High altitude (${v.elevationM.toLocaleString()} m) — thinner air, the ball flies and legs tire faster.`;
  if (v.elevationM >= 500) return `Moderate altitude (${v.elevationM.toLocaleString()} m).`;
  if (v.roof === 'fixed') return 'Enclosed roof — loud, climate-controlled, no weather.';
  if (v.roof === 'retractable') return 'Retractable roof — can be sealed against heat or rain.';
  if (v.capacity >= 75000) return 'One of the largest hosts — a huge, intense crowd.';
  return 'Open-air stadium.';
}
