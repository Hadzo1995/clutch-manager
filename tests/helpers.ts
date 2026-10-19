import { createCareer, createWorld, starterCoaches } from '../src/engine/career';
import type { Career, World } from '../src/engine/career';
import { generateSyntheticDataset } from '../src/engine/data/generateDataset';
import { aiToMatchPlayer, emptyMapPractice } from '../src/engine/team';
import type { TeamSnapshot } from '../src/engine/team';
import type { PlayerProfile, Role, Tactics } from '../src/engine/types';
import { ROLES } from '../src/engine/types';

let cached: World | null = null;
export function world(): World {
  cached ??= createWorld(generateSyntheticDataset());
  return cached;
}

export function newCareer(seed = 42): Career {
  const w = world();
  return createCareer(w, { managerName: 'Test', teamName: 'Testers', teamTag: 'TST', coachId: starterCoaches(w)[0]!.id, seed, today: '2026-10-10' });
}

export const BALANCED: Tactics = { playstyle: 'balanced', tApproach: 'default', ctSetup: 'standard', stackSite: 'A' };

export function snapshot(id: string, players: PlayerProfile[], roles: Role[] = [...ROLES], over: Partial<TeamSnapshot> = {}): TeamSnapshot {
  return {
    id, name: id, tag: id.toUpperCase().slice(0, 4), isHuman: true,
    players: players.map((p, i) => ({ ...aiToMatchPlayer(p, roles[i]!, 85), id: `${id}-${p.record.id}` })),
    coach: null, chemistry: 60, mapPractice: emptyMapPractice(50), tactics: { ...BALANCED },
    tendencies: { t: { default: 1, execute: 1, rush: 1 }, ct: { standard: 1, stack: 1, retake: 1, aggro: 1 }, aSiteBias: 0.5 },
    prepBonus: 0, ...over,
  };
}

/** One player per role, taken from a band of the OVR-sorted pool. */
export function teamFromBand(start: number, used = new Set<string>()): PlayerProfile[] {
  const sorted = [...world().profileList].sort((a, b) => b.ovr - a.ovr);
  return ROLES.map((r) => {
    const p = sorted.slice(start).find((x) => x.record.primaryRole === r && !used.has(x.record.id))!;
    used.add(p.record.id);
    return p;
  });
}
