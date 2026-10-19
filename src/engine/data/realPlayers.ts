/**
 * Real pro players (decision D4): rosters and team strength from Valve's public
 * Regional Standings, countries/ages/roles from Liquipedia (CC BY-SA 3.0), and
 * Clutch Manager's own ratings (team level + role + a small bonus for picked stars).
 * No HLTV data. The snapshot is embedded at build time; see tools/realdata/.
 */
import type { Dataset } from '../types';
import { importCsv } from './importer';
import { REAL_PLAYERS_CSV, REAL_SNAPSHOT_DATE } from './realPlayers.generated';

export const REAL_DATASET_ID = `real-pros-${REAL_SNAPSHOT_DATE}`;
export const REAL_SOURCE = 'Valve Regional Standings + Liquipedia; ratings by Clutch Manager';
export { REAL_SNAPSHOT_DATE };

let cached: Dataset | null = null;

/** The embedded real-player dataset, or null if the embedded file fails validation. */
export function realDataset(): Dataset | null {
  if (cached) return cached;
  const r = importCsv(REAL_PLAYERS_CSV, { sourceName: 'real-pros', snapshotDate: REAL_SNAPSHOT_DATE, now: REAL_SNAPSHOT_DATE });
  if (!r.ok || !r.dataset) return null;
  cached = {
    ...r.dataset,
    id: REAL_DATASET_ID,
    label: `Real pros (Valve standings ${REAL_SNAPSHOT_DATE})`,
    players: r.dataset.players.map((p) => ({ ...p, id: `pro-${p.handle.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, provenance: { ...p.provenance, source: REAL_SOURCE, kind: 'public' } })),
  };
  return cached;
}
