/**
 * Real pro players (decision D4): rosters and team strength from Valve's public
 * Regional Standings, countries/ages/roles from Liquipedia (CC BY-SA 3.0), and
 * Clutch Manager's own ratings (team level + role + a small bonus for picked stars).
 * No HLTV data. The snapshot is embedded at build time; see tools/realdata/.
 */
import type { Dataset } from '../types';
import { importCsv } from './importer';
import { REAL_PLAYERS_CSV, REAL_SNAPSHOT_DATE } from './realPlayers.generated';
import { PLAYER_FIXES } from './playerFixes';

export const REAL_DATASET_ID = `real-pros-${REAL_SNAPSHOT_DATE}`;
export const REAL_SOURCE = 'Valve Regional Standings + Liquipedia; ratings by Clutch Manager';
export { REAL_SNAPSHOT_DATE };

let cached: Dataset | null = null;

/** The embedded real-player dataset, or null if the embedded file fails validation. */
export function realDataset(): Dataset | null {
  if (cached) return cached;
  const r = importCsv(REAL_PLAYERS_CSV, { sourceName: 'real-pros', snapshotDate: REAL_SNAPSHOT_DATE, now: REAL_SNAPSHOT_DATE });
  if (!r.ok || !r.dataset) return null;
  const teamOf = teamsByHandle(REAL_PLAYERS_CSV);
  cached = {
    ...r.dataset,
    id: REAL_DATASET_ID,
    label: `Real pros (Valve standings ${REAL_SNAPSHOT_DATE})`,
    players: r.dataset.players.map((p) => ({ ...p, ...(PLAYER_FIXES[p.handle]?.country ? { country: PLAYER_FIXES[p.handle]!.country! } : {}), team: teamOf.get(p.handle), id: `pro-${p.handle.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, provenance: { ...p.provenance, source: REAL_SOURCE, kind: 'public' } })),
  };
  return cached;
}

/** handle -> team from the embedded CSV (the importer keeps only the columns the engine rates). */
function teamsByHandle(csv: string): Map<string, string> {
  const lines = csv.trim().split('\n');
  const header = lines[0]!.split(',');
  const h = header.indexOf('handle');
  const t = header.indexOf('team');
  const out = new Map<string, string>();
  if (h < 0 || t < 0) return out;
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    if (cells[h] && cells[t]) out.set(cells[h]!, cells[t]!);
  }
  return out;
}
