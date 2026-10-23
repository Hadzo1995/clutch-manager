/**
 * The real-player database hangs together: stable unique ids, valid roles and countries,
 * every team branded, every HLTV line and photo pointing at a real player, and every player
 * reachable by the systems that use them (tiers, rarity, cases).
 */
import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/engine/career';
import { CASES, caseTable } from '../src/engine/cases';
import { HLTV_STATS } from '../src/engine/data/hltvStats.generated';
import { PLAYER_FIXES } from '../src/engine/data/playerFixes';
import { PLAYER_PHOTOS } from '../src/engine/data/playerPhotos.generated';
import { realDataset } from '../src/engine/data/realPlayers';
import { REAL_TEAMS } from '../src/engine/data/realTeams';
import { ROLES } from '../src/engine/types';

const ds = realDataset()!;
const ids = new Set(ds.players.map((p) => p.id));

describe('real-player database', () => {
  it('ids are stable, unique and derived from the handle', () => {
    expect(ids.size).toBe(ds.players.length);
    for (const p of ds.players) expect(p.id).toBe(`pro-${p.handle.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
  });

  it('roles are valid and distinct, countries are codes, every team is a branded org', () => {
    for (const p of ds.players) {
      expect(ROLES).toContain(p.primaryRole);
      expect(ROLES).toContain(p.secondaryRole);
      expect(p.secondaryRole).not.toBe(p.primaryRole);
      expect(p.country).toMatch(/^[A-Z]{2}$/);
      expect(REAL_TEAMS[p.team!], p.handle).toBeDefined();
    }
    // Countries still unknown after the fixes (shown as a dash in the game).
    expect(ds.players.filter((p) => p.country === 'UN').map((p) => p.handle)).toEqual(['tyr1k']);
  });

  it('every fix, HLTV line and photo refers to a player in the database', async () => {
    // node:fs without Node typings in this project's tsconfig.
    const fsName = 'node:fs';
    const { existsSync } = (await import(/* @vite-ignore */ fsName)) as { existsSync: (p: string) => boolean };
    const handles = new Set(ds.players.map((p) => p.handle));
    for (const h of Object.keys(PLAYER_FIXES)) expect(handles.has(h), h).toBe(true);
    for (const id of Object.keys(HLTV_STATS)) expect(ids.has(id), id).toBe(true);
    const hltvIds = Object.values(HLTV_STATS).map((h) => h.hltvId);
    expect(new Set(hltvIds).size).toBe(hltvIds.length);
    for (const [id, photo] of Object.entries(PLAYER_PHOTOS)) {
      expect(ids.has(id), id).toBe(true);
      expect(existsSync(`public/${photo.src}`), photo.src).toBe(true);
    }
  });

  it('every player has a tier and rarity and can drop from the Scout Case', () => {
    const w = createWorld(ds);
    const inCase = new Set(caseTable(CASES.standard, w.profileList).flatMap((r) => r.players.map((p) => p.record.id)));
    for (const p of w.profileList) {
      expect(p.tier).toBeTruthy();
      expect(p.potential).toBeGreaterThanOrEqual(p.ovr);
      expect(inCase.has(p.record.id), p.record.handle).toBe(true);
    }
  });
});
