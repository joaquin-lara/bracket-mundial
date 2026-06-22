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
  lat: number; // stadium latitude (for the home-screen globe)
  lon: number; // stadium longitude
  /** Aliases (sponsor names, FIFA names, city) we may see in the fixtures feed. */
  aliases: string[];
}

export const VENUES: Venue[] = [
  { stadium: 'Mercedes-Benz Stadium', city: 'Atlanta', country: 'USA', capacity: 71000, roof: 'retractable', elevationM: 320, lat: 33.755, lon: -84.401, aliases: ['atlanta', 'mercedes-benz', 'mercedes benz'] },
  { stadium: 'Gillette Stadium', city: 'Boston', country: 'USA', capacity: 65878, roof: 'open', elevationM: 28, lat: 42.091, lon: -71.264, aliases: ['boston', 'foxborough', 'gillette'] },
  { stadium: 'AT&T Stadium', city: 'Dallas', country: 'USA', capacity: 80000, roof: 'retractable', elevationM: 167, lat: 32.748, lon: -97.093, aliases: ['dallas', 'arlington', 'at&t', 'att stadium'] },
  { stadium: 'NRG Stadium', city: 'Houston', country: 'USA', capacity: 72220, roof: 'retractable', elevationM: 12, lat: 29.685, lon: -95.411, aliases: ['houston', 'nrg'] },
  { stadium: 'Arrowhead Stadium', city: 'Kansas City', country: 'USA', capacity: 76416, roof: 'open', elevationM: 270, lat: 39.049, lon: -94.484, aliases: ['kansas city', 'kansas', 'arrowhead'] },
  { stadium: 'SoFi Stadium', city: 'Los Angeles', country: 'USA', capacity: 70240, roof: 'fixed', elevationM: 30, lat: 33.953, lon: -118.339, aliases: ['los angeles', 'inglewood', 'sofi'] },
  { stadium: 'Hard Rock Stadium', city: 'Miami', country: 'USA', capacity: 65326, roof: 'open', elevationM: 2, lat: 25.958, lon: -80.239, aliases: ['miami', 'miami gardens', 'hard rock'] },
  { stadium: 'MetLife Stadium', city: 'New York / New Jersey', country: 'USA', capacity: 82500, roof: 'open', elevationM: 7, lat: 40.814, lon: -74.074, aliases: ['new york', 'new jersey', 'east rutherford', 'metlife'] },
  { stadium: 'Lincoln Financial Field', city: 'Philadelphia', country: 'USA', capacity: 69176, roof: 'open', elevationM: 12, lat: 39.901, lon: -75.168, aliases: ['philadelphia', 'lincoln financial'] },
  { stadium: "Levi's Stadium", city: 'San Francisco Bay Area', country: 'USA', capacity: 68500, roof: 'open', elevationM: 4, lat: 37.403, lon: -121.970, aliases: ['san francisco', 'santa clara', 'bay area', 'levi'] },
  { stadium: 'Lumen Field', city: 'Seattle', country: 'USA', capacity: 69000, roof: 'open', elevationM: 5, lat: 47.595, lon: -122.332, aliases: ['seattle', 'lumen'] },
  { stadium: 'Estadio Akron', city: 'Guadalajara', country: 'Mexico', capacity: 48071, roof: 'open', elevationM: 1566, lat: 20.682, lon: -103.463, aliases: ['guadalajara', 'akron', 'zapopan'] },
  { stadium: 'Estadio Azteca', city: 'Mexico City', country: 'Mexico', capacity: 87523, roof: 'open', elevationM: 2240, lat: 19.303, lon: -99.150, aliases: ['mexico city', 'ciudad de mexico', 'azteca', 'banorte'] },
  { stadium: 'Estadio BBVA', city: 'Monterrey', country: 'Mexico', capacity: 53500, roof: 'open', elevationM: 537, lat: 25.669, lon: -100.244, aliases: ['monterrey', 'bbva', 'guadalupe'] },
  { stadium: 'BMO Field', city: 'Toronto', country: 'Canada', capacity: 45000, roof: 'open', elevationM: 76, lat: 43.633, lon: -79.418, aliases: ['toronto', 'bmo'] },
  { stadium: 'BC Place', city: 'Vancouver', country: 'Canada', capacity: 54500, roof: 'retractable', elevationM: 3, lat: 49.277, lon: -123.112, aliases: ['vancouver', 'bc place'] },
];

function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

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

/** Compact one-line label ("Stadium · City") for list rows, or the raw string. */
export function venueLabel(raw: string | null | undefined): string | null {
  const v = lookupVenue(raw);
  if (v) return `${v.stadium} · ${v.city}`;
  return raw ?? null;
}
