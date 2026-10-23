/**
 * Real organisations for the real-pro dataset: display name, a short tag and two brand-style
 * colours (primary field, accent). Keys are the team names as they appear in the embedded
 * standings CSV. Colours are approximations used for badges, booths and jerseys; no logos.
 */
export interface RealTeamMeta {
  name: string;
  tag: string;
  primary: string;
  accent: string;
}

const T = (name: string, tag: string, primary: string, accent: string): RealTeamMeta => ({ name, tag, primary, accent });

export const REAL_TEAMS: Record<string, RealTeamMeta> = {
  MOUZ: T('MOUZ', 'MOUZ', '#d3112c', '#f4f4f4'),
  Spirit: T('Team Spirit', 'SPR', '#1b1b1d', '#f2f2f2'),
  Legacy: T('Legacy', 'LGC', '#0f6b5c', '#e9f5f1'),
  Vitality: T('Team Vitality', 'VIT', '#f6d10a', '#141414'),
  G2: T('G2 Esports', 'G2', '#151515', '#e2231a'),
  Falcons: T('Team Falcons', 'FLC', '#0f8a4f', '#f2f2f2'),
  FURIA: T('FURIA', 'FUR', '#121212', '#f2f2f2'),
  Aurora: T('Aurora', 'AUR', '#2a1a4a', '#b78cff'),
  BETBOOM: T('BetBoom Team', 'BB', '#e1006e', '#151515'),
  FUT: T('FUT Esports', 'FUT', '#0c1c3c', '#2ad1c9'),
  Astralis: T('Astralis', 'AST', '#e11b22', '#f2f2f2'),
  MIBR: T('MIBR', 'MIBR', '#0b2d6b', '#f2f2f2'),
  B8: T('B8', 'B8', '#141414', '#ff3b3b'),
  HEROIC: T('HEROIC', 'HER', '#f15a24', '#141414'),
  Nemiga: T('Nemiga', 'NEM', '#1b2a44', '#f0c419'),
  Liquid: T('Team Liquid', 'TL', '#0a1f3d', '#5ab0ff'),
  '9z': T('9z Team', '9Z', '#141414', '#f2c94c'),
  Luminosity: T('Luminosity Gaming', 'LG', '#0b3b66', '#55c2ff'),
  'Ninjas in Pyjamas': T('Ninjas in Pyjamas', 'NIP', '#121212', '#b8e04a'),
  'Inner Circle': T('Inner Circle', 'IC', '#1d1d2b', '#ff7a45'),
  '3DMAX': T('3DMAX', '3DM', '#0f1e3a', '#ff4d6d'),
  M80: T('M80', 'M80', '#151515', '#ffd23f'),
  magic: T('magic', 'MGC', '#3b1d5c', '#e8c2ff'),
  Alliance: T('Alliance', 'ALL', '#101820', '#9fd3ff'),
  BIG: T('BIG', 'BIG', '#111111', '#f2f2f2'),
  FaZe: T('FaZe Clan', 'FAZE', '#e43d30', '#141414'),
  GamerLegion: T('GamerLegion', 'GL', '#c2102a', '#f4f4f4'),
  '100 Thieves': T('100 Thieves', '100T', '#e2231a', '#f4f4f4'),
  Nemesis: T('Nemesis', 'NMS', '#2c0e0e', '#ff5a5a'),
  JiJieHao: T('JiJieHao', 'JJH', '#0d2a4a', '#ffd166'),
  HOTU: T('HOTU', 'HOTU', '#13202b', '#4fd1c5'),
  K27: T('K27', 'K27', '#1a1a1a', '#ff9f1c'),
  'Eternal Fire': T('Eternal Fire', 'EF', '#ad1f1f', '#ffc04a'),
  'Natus Vincere': T('Natus Vincere', 'NAVI', '#ffe600', '#141414'),
  fnatic: T('fnatic', 'FNC', '#ff5900', '#141414'),
  PARIVISION: T('PARIVISION', 'PARI', '#1c1c3a', '#7dd3fc'),
  BBL: T('BBL Esports', 'BBL', '#141414', '#ffcc00'),
  '1win': T('1win', '1WIN', '#0d47a1', '#f4f4f4'),
  DENDELE: T('DENDELE', 'DND', '#20242c', '#f97316'),
  Sangal: T('Sangal', 'SGL', '#0b3d2e', '#f4f4f4'),
  SINNERS: T('SINNERS', 'SIN', '#141414', '#d7263d'),
  SAW: T('SAW', 'SAW', '#16213e', '#e94560'),
  EYEBALLERS: T('EYEBALLERS', 'EYE', '#13131f', '#8be9fd'),
  TYLOO: T('TYLOO', 'TYL', '#c8102e', '#ffd700'),
  Betclic: T('Betclic Apogee', 'BTC', '#d1001f', '#141414'),
  'Nuclear TigeRES': T('Nuclear TigeRES', 'NTR', '#1a1a1a', '#ff8c00'),
  NRG: T('NRG', 'NRG', '#141414', '#f2f2f2'),
  FOKUS: T('FOKUS', 'FOK', '#0e2433', '#33d1ff'),
  'The MongolZ': T('The MongolZ', 'MGZ', '#1c2f6b', '#e63946'),
  'BC.Game': T('BC.Game Esports', 'BCG', '#0f1d14', '#36d27a'),
  'Virtus.pro': T('Virtus.pro', 'VP', '#ff5000', '#141414'),
  Imperial: T('Imperial', 'IMP', '#141414', '#c6f432'),
  Metizport: T('Metizport', 'MTZ', '#102a43', '#f0b429'),
  paiN: T('paiN Gaming', 'PAIN', '#141414', '#e10600'),
  Fluxo: T('Fluxo', 'FLX', '#2b0f4c', '#ff4fd8'),
  INFINITE: T('INFINITE', 'INF', '#0e1a2b', '#7aa2ff'),
  'Iberian Soul': T('Iberian Soul', 'IBS', '#6b0f1a', '#f4c430'),
  Color: T('Color', 'CLR', '#1f1147', '#ff6ec7'),
  Wildcard: T('Wildcard', 'WLD', '#121212', '#ffb000'),
  WBT: T('WBT', 'WBT', '#0f2027', '#56ccf2'),
  CYBERSHOKE: T('CYBERSHOKE', 'CYB', '#141414', '#00e5ff'),
  SportsBetExpert: T('SportsBetExpert', 'SBE', '#0f2a1d', '#2ee59d'),
  Acend: T('Acend', 'ACE', '#1a1030', '#c084fc'),
  'Lynn Vision': T('Lynn Vision', 'LVG', '#0b2545', '#8ecae6'),
};

const byName = new Map<string, RealTeamMeta>();
for (const m of Object.values(REAL_TEAMS)) byName.set(m.name, m);

/** Meta for a real org by its display name (as stored on AI teams), or undefined for fictional clubs. */
export function realTeamByName(name: string): RealTeamMeta | undefined {
  return byName.get(name);
}

/** The org's brightest brand colour, for glows and light (very dark primaries fall back to the accent). */
export function orgGlow(m: RealTeamMeta): string {
  const lum = (hex: string) => { const n = parseInt(hex.slice(1), 16); return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; };
  const p = lum(m.primary), a = lum(m.accent);
  // The primary unless it is near-black; then the accent, unless that is plain white.
  return p > 0.15 ? m.primary : a < 0.92 ? m.accent : '#cfd6df';
}

/** Meta for a real org by its key in the standings CSV, or a neutral fallback for unknown orgs. */
export function realTeamMeta(key: string): RealTeamMeta {
  return REAL_TEAMS[key] ?? T(key, key.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase() || 'ORG', '#1e2430', '#e6e9ef');
}

/** Jersey colour for a team shown by display name (AI clubs), or undefined for fictional clubs. */
export function orgJersey(name: string | undefined): string | undefined {
  return name ? byName.get(name)?.primary : undefined;
}

/** Jersey colour for a real player's org key from the standings, or undefined. */
export function playerJersey(team: string | undefined): string | undefined {
  return team ? REAL_TEAMS[team]?.primary : undefined;
}
