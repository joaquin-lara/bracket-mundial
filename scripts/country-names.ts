/**
 * One canonical country-name key, shared by every cross-source join.
 *
 * Three datasets spell nations differently: the results dataset (the model's
 * universe), the FIFA/sofifa `nationality_name` column, and fbref team names.
 * `countryKey()` folds all three onto a single normalised key (the results
 * dataset's spelling), so a team matches itself across sources.
 *
 * The alias list was built by auditing EVERY distinct name in all three sources
 * (scripts checked 336 results teams, 192 FIFA nationalities, 159 fbref teams);
 * the entries below are the only ones that don't already coincide after
 * accent/case/punctuation stripping. Verified target spellings exist in the
 * results dataset.
 */

/** Strip accents, case and punctuation/spaces -> a bare alphanumeric key. */
export function norm(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// normalised source spelling -> normalised canonical (results-dataset) spelling
const ALIASES: Record<string, string> = {
  // FIFA `nationality_name` variants
  korearepublic: 'southkorea',
  koreadpr: 'northkorea',
  chinapr: 'china',
  congodr: 'drcongo',
  cotedivoire: 'ivorycoast',
  holland: 'netherlands',
  capeverdeislands: 'capeverde',
  caboverde: 'capeverde',
  bruneidarussalam: 'brunei',
  swaziland: 'eswatini',
  saotomeeprincipe: 'saotomeandprincipe',
  stkittsandnevis: 'saintkittsandnevis',
  stlucia: 'saintlucia',
  chinesetaipei: 'taiwan',
  // fbref team-name variants
  antigua: 'antiguaandbarbuda',
  bosniaherzegovina: 'bosniaandherzegovina',
  car: 'centralafricanrepublic',
  czechia: 'czechrepublic',
  dominicanrep: 'dominicanrepublic',
  equguinea: 'equatorialguinea',
  iriran: 'iran',
  nmacedonia: 'northmacedonia',
  repofireland: 'republicofireland',
  stkittsnevis: 'saintkittsandnevis',
  stvincent: 'saintvincentandthegrenadines',
  saotome: 'saotomeandprincipe',
  trintobago: 'trinidadandtobago',
  turkscaicos: 'turksandcaicosislands',
  turkiye: 'turkey',
  usvirginislands: 'unitedstatesvirginislands',
  // common abbreviations seen in other feeds
  usa: 'unitedstates',
  uae: 'unitedarabemirates',
};

/** Canonical join key for a nation/team name from any of the three sources. */
export function countryKey(name: string): string {
  const k = norm(name);
  return ALIASES[k] ?? k;
}
