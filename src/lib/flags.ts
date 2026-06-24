// FIFA three-letter codes (as served by football-data.org) mapped to ISO
// alpha-2 codes for flagcdn.com images. Covers all 48 qualified teams,
// extracted from the live WC 2026 fixtures payload.
export const FLAG_CODES: Record<string, string> = {
  ALG: 'dz', // Algeria
  ARG: 'ar', // Argentina
  AUS: 'au', // Australia
  AUT: 'at', // Austria
  BEL: 'be', // Belgium
  BIH: 'ba', // Bosnia-Herzegovina
  BRA: 'br', // Brazil
  CAN: 'ca', // Canada
  CHI: 'cl', // Chile
  CIV: 'ci', // Ivory Coast
  COD: 'cd', // Congo DR
  COL: 'co', // Colombia
  CPV: 'cv', // Cape Verde Islands
  CRO: 'hr', // Croatia
  CUR: 'cw', // Curaçao
  CUW: 'cw', // Curaçao (code variant served by football-data)
  CZE: 'cz', // Czechia
  ECU: 'ec', // Ecuador
  EGY: 'eg', // Egypt
  ENG: 'gb-eng', // England
  ESP: 'es', // Spain
  FRA: 'fr', // France
  GER: 'de', // Germany
  GHA: 'gh', // Ghana
  GUA: 'gt', // Guatemala
  HAI: 'ht', // Haiti
  HON: 'hn', // Honduras
  IRN: 'ir', // Iran
  IRQ: 'iq', // Iraq
  JOR: 'jo', // Jordan
  JPN: 'jp', // Japan
  KOR: 'kr', // South Korea
  KSA: 'sa', // Saudi Arabia
  MAR: 'ma', // Morocco
  MEX: 'mx', // Mexico
  NCA: 'ni', // Nicaragua
  NED: 'nl', // Netherlands
  NOR: 'no', // Norway
  NZL: 'nz', // New Zealand
  PAN: 'pa', // Panama
  PAR: 'py', // Paraguay
  POR: 'pt', // Portugal
  QAT: 'qa', // Qatar
  RSA: 'za', // South Africa
  SCO: 'gb-sct', // Scotland
  SEN: 'sn', // Senegal
  SUI: 'ch', // Switzerland
  SWE: 'se', // Sweden
  TUN: 'tn', // Tunisia
  TUR: 'tr', // Turkey
  URU: 'uy', // Uruguay
  URY: 'uy', // Uruguay (alternate code)
  USA: 'us', // United States
  UZB: 'uz', // Uzbekistan
};

export function flagUrl(tla: string | null | undefined): string | null {
  const a2 = tla ? FLAG_CODES[tla] : undefined;
  return a2 ? `https://flagcdn.com/w40/${a2}.png` : null;
}

// Human-readable country names for the sign-up flag picker. Alternate code
// variants (CUW, URY) are intentionally omitted to avoid duplicate entries.
const COUNTRY_NAMES: Record<string, string> = {
  ALG: 'Algeria', ARG: 'Argentina', AUS: 'Australia', AUT: 'Austria', BEL: 'Belgium',
  BIH: 'Bosnia-Herzegovina', BRA: 'Brazil', CAN: 'Canada', CHI: 'Chile', CIV: 'Ivory Coast',
  COD: 'Congo DR', COL: 'Colombia', CPV: 'Cape Verde', CRO: 'Croatia', CUR: 'Curaçao',
  CZE: 'Czechia', ECU: 'Ecuador', EGY: 'Egypt', ENG: 'England', ESP: 'Spain', FRA: 'France',
  GER: 'Germany', GHA: 'Ghana', GUA: 'Guatemala', HAI: 'Haiti', HON: 'Honduras', IRN: 'Iran',
  IRQ: 'Iraq', JOR: 'Jordan', JPN: 'Japan', KOR: 'South Korea', KSA: 'Saudi Arabia',
  MAR: 'Morocco', MEX: 'Mexico', NCA: 'Nicaragua', NED: 'Netherlands', NOR: 'Norway',
  NZL: 'New Zealand', PAN: 'Panama', PAR: 'Paraguay', POR: 'Portugal', QAT: 'Qatar',
  RSA: 'South Africa', SCO: 'Scotland', SEN: 'Senegal', SUI: 'Switzerland', SWE: 'Sweden',
  TUN: 'Tunisia', TUR: 'Turkey', URU: 'Uruguay', USA: 'United States', UZB: 'Uzbekistan',
};

/** Sorted [code, name] pairs for the sign-up country dropdown. */
export const COUNTRY_OPTIONS: { code: string; name: string }[] = Object.entries(COUNTRY_NAMES)
  .map(([code, name]) => ({ code, name }))
  .sort((a, b) => a.name.localeCompare(b.name));
