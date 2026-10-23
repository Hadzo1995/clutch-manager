/**
 * Hand-checked corrections to the embedded real-player list. Each one names its source; a fix
 * is only listed when the source shows the same player (same HLTV id and the same team as ours).
 * Applied in realPlayers.ts on top of the generated snapshot, so regenerating the snapshot
 * never loses them and adding a fix is one line here.
 */
export interface PlayerFix { country?: string; source: string }

const HLTV = 'HLTV.org stats page saved 2026-10-23';

/** Keyed by handle, exactly as in the snapshot. */
export const PLAYER_FIXES: Record<string, PlayerFix> = {
  MATYS: { country: 'SK', source: `${HLTV} (id 21062, G2)` },
  Lucky: { country: 'FR', source: `${HLTV} (id 13497, 3DMAX)` },
  fEAR: { country: 'UA', source: `${HLTV} (id 17803, fnatic)` },
  Rkzinho: { country: 'BR', source: `${HLTV} (id 25087, paiN)` },
  Sonic: { country: 'ZA', source: `${HLTV} (id 8711, NRG)` },
  Tatu: { country: 'BR', source: `${HLTV} (id 24089, paiN Academy)` },
  z4KR: { country: 'CN', source: `${HLTV} (id 18744, Lynn Vision)` },
  alpha: { country: 'RU', source: `${HLTV} (id 20430, CYBERSHOKE)` },
};
