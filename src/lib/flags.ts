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
  URY: 'uy', // Uruguay
  USA: 'us', // United States
  UZB: 'uz', // Uzbekistan
};

export function flagUrl(tla: string | null | undefined): string | null {
  const a2 = tla ? FLAG_CODES[tla] : undefined;
  return a2 ? `https://flagcdn.com/w40/${a2}.png` : null;
}
