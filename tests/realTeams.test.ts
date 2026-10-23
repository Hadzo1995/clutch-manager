import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/engine/career';
import { realDataset } from '../src/engine/data/realPlayers';
import { REAL_TEAMS, realTeamByName } from '../src/engine/data/realTeams';
import { DIVISIONS, generateAiTeams } from '../src/engine/season';
import { Rng } from '../src/engine/rng';
import { ROLES } from '../src/engine/types';

describe('real organisations', () => {
  const w = createWorld(realDataset()!);

  it('every org in the snapshot has a tag and colours', () => {
    const teams = new Set(realDataset()!.players.map((p) => p.team));
    expect(teams.size).toBe(64);
    for (const t of teams) expect(REAL_TEAMS[t!], t).toBeDefined();
    const tags = Object.values(REAL_TEAMS).map((m) => m.tag);
    expect(new Set(tags).size).toBe(tags.length);
  });

  it('each division is made of real orgs playing their own five, with every role covered once', () => {
    for (const div of DIVISIONS) {
      for (const seed of [1, 2, 3]) {
        const teams = generateAiTeams(new Rng(seed), div, w.profileList, w.coaches);
        expect(teams).toHaveLength(7);
        const all = teams.flatMap((t) => t.playerIds);
        expect(new Set(all).size).toBe(all.length);
        for (const t of teams) {
          const org = realTeamByName(t.name);
          expect(org, t.name).toBeDefined();
          expect([...t.roles].sort()).toEqual([...ROLES].sort());
          const own = t.playerIds.filter((id) => REAL_TEAMS[w.profiles.get(id)!.record.team!]?.name === t.name);
          expect(own.length).toBe(5);
        }
      }
    }
  });

  it('a signed player is replaced by a free player, so nobody plays for two teams', () => {
    const vitality = w.profileList.filter((p) => p.record.team === 'Vitality');
    const owned = new Set([vitality[0]!.record.id]);
    const pool = w.profileList.filter((p) => !owned.has(p.record.id));
    let seen = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const teams = generateAiTeams(new Rng(seed), DIVISIONS[3]!, pool, w.coaches);
      const vit = teams.find((t) => t.name === 'Team Vitality');
      if (!vit) continue;
      seen++;
      expect(vit.playerIds).toHaveLength(5);
      expect(vit.playerIds).not.toContain(vitality[0]!.record.id);
    }
    expect(seen).toBeGreaterThan(0);
  });
});
