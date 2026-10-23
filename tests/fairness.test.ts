/**
 * Training beats luck: a manager who drew lower-tier cards but trains them well should catch up
 * with one who drew better cards and only runs the default (team-only) plan. Tiers still matter:
 * the same good training on better cards ends higher.
 */
import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/engine/career';
import { realDataset } from '../src/engine/data/realPlayers';
import { MapSim } from '../src/engine/match';
import { cardOvr } from '../src/engine/ratings';
import { Rng } from '../src/engine/rng';
import { cardToMatchPlayer, emptyMapPractice } from '../src/engine/team';
import type { TeamSnapshot } from '../src/engine/team';
import { defaultPlan, runTraining } from '../src/engine/training';
import type { ActivityId } from '../src/engine/training';
import { MAPS, ROLES } from '../src/engine/types';
import type { Attribute, OwnedCard, PlayerProfile, Tier } from '../src/engine/types';

const w = createWorld(realDataset()!);
const FOCUS: Record<string, Attribute> = { entry: 'entry', awp: 'awp', support: 'utility', lurker: 'positioning', igl: 'leadership' };
const DILIGENT: ActivityId[][] = [['coaching', 'aim', 'rest'], ['coaching', 'entrytrade', 'utility'], ['coaching', 'clutch', 'rest'], ['awp', 'deathmatch', 'rest']];

/** One player per role from a tier (youngest first, as a fresh draw would often be). */
function five(tier: Tier): PlayerProfile[] {
  const pool = w.profileList.filter((p) => p.tier === tier).sort((a, b) => a.record.age - b.record.age);
  return ROLES.map((r, i) => pool.find((p) => p.record.primaryRole === r) ?? pool[i]!);
}

function train(ps: PlayerProfile[], diligent: boolean, weeks: number): OwnedCard[] {
  const coaches = [...w.coaches].sort((a, b) => b.attrs.development - a.attrs.development);
  const cards = ps.map((p) => ({ cardId: p.record.id, playerId: p.record.id, acquiredWeek: 0, growth: {}, stars: 0, sharpness: 80, fatigue: 0, morale: 60, form: 0, matchesPlayed: 0 }) as OwnedCard);
  const rng = new Rng(11);
  for (let wk = 1; wk <= weeks; wk++) {
    const sessions = diligent ? DILIGENT[wk % DILIGENT.length]! : defaultPlan().sessions;
    const focus = diligent ? Object.fromEntries(ps.map((p) => [p.record.id, FOCUS[p.record.primaryRole]!])) : {};
    const out = runTraining({ sessions: [...sessions], focusMap: 'Mirage', individualFocus: focus }, cards.map((c, i) => ({ card: c, profile: ps[i]! })), diligent ? coaches[0]! : coaches[coaches.length - 1]!, rng);
    for (const c of cards) {
      for (const [k, v] of Object.entries(out.gains[c.cardId] ?? {})) (c.growth as Record<string, number>)[k] = ((c.growth as Record<string, number>)[k] ?? 0) + (v ?? 0);
      c.fatigue = Math.max(0, (out.fatigueAfter[c.cardId] ?? 0) - 25); // match day and rest recover most of it
    }
  }
  return cards;
}

const avgOvr = (ps: PlayerProfile[], cs: OwnedCard[]) => ps.reduce((s, p, i) => s + cardOvr(p, cs[i]!), 0) / ps.length;

function team(id: string, ps: PlayerProfile[], cs: OwnedCard[]): TeamSnapshot {
  return {
    id, name: id, tag: id, isHuman: true, players: ps.map((p, i) => cardToMatchPlayer(p, cs[i]!, ROLES[i]!)), coach: null, chemistry: 60,
    mapPractice: emptyMapPractice(50), tactics: { playstyle: 'balanced', tApproach: 'default', ctSetup: 'standard', stackSite: 'A' },
    tendencies: { t: { default: 1, execute: 1, rush: 1 }, ct: { standard: 1, stack: 1, retake: 1, aggro: 1 }, aSiteBias: 0.5 }, prepBonus: 0,
  };
}

function winRate(a: TeamSnapshot, b: TeamSnapshot, n = 120): number {
  let wins = 0;
  for (let s = 1; s <= n; s++) if (new MapSim({ seed: s * 7919, teams: [a, b], map: MAPS[s % MAPS.length]!, ctFirst: (s % 2) as 0 | 1 }).playToEnd().winner === 0) wins++;
  return wins / n;
}

describe('training beats luck', () => {
  it('lucky draws start ahead', () => {
    expect(avgOvr(five('S'), train(five('S'), false, 0))).toBeGreaterThan(avgOvr(five('A'), train(five('A'), true, 0)));
  });

  it('after one season, the same cards trained well clearly beat the same cards trained lazily', () => {
    const ps = five('S');
    const T = train(ps, true, 12), L = train(ps, false, 12);
    expect(avgOvr(ps, T)).toBeGreaterThan(avgOvr(ps, L) + 2);
    expect(winRate(team('t', ps, T), team('l', ps, L))).toBeGreaterThan(0.6);
  });

  it('after one season, well-trained A-tier cards beat lazily trained S-tier cards in matches', () => {
    const lucky = five('S'), worked = five('A');
    const L = train(lucky, false, 12), T = train(worked, true, 12);
    const r = winRate(team('t', worked, T), team('l', lucky, L));
    console.log(`A trained ${avgOvr(worked, T).toFixed(1)} vs S lazy ${avgOvr(lucky, L).toFixed(1)}: A wins ${(r * 100).toFixed(0)}% of maps`);
    expect(r).toBeGreaterThan(0.5);
  });

  it('tiers still matter: the same good training ends higher on better cards, and caps hold', () => {
    const top = five('S+'), low = five('B');
    const a = train(top, true, 36), b = train(low, true, 36);
    expect(avgOvr(top, a)).toBeGreaterThan(avgOvr(low, b) + 4);
    low.forEach((p, i) => expect(cardOvr(p, b[i]!)).toBeLessThanOrEqual(p.potential));
  });
});
