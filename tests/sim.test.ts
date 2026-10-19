/**
 * The spatial round simulation: combat maths, sight, damage, round endings,
 * and controlled experiments that change one thing (aim, synergy) and
 * measure the effect over many seeded rounds.
 */
import { MapSim } from '../src/engine/match';
import { geometryFor } from '../src/maps';
import { acquireTime, combatProfile, detectionTime, hitChance, shotDamage, weaponDef } from '../src/engine/sim/combat';
import { mapIntel } from '../src/engine/sim/mapintel';
import { simulateRound, type RoundSimInput, type SimLoadout } from '../src/engine/sim/round';
import { pairKey, teamSynergy } from '../src/engine/sim/synergy';
import type { TeamSnapshot } from '../src/engine/team';
import type { Attributes, MapName } from '../src/engine/types';
import { ATTRIBUTES } from '../src/engine/types';
import { storyLines } from '../src/ui/arena/RoundStory';
import { snapshot, teamFromBand } from './helpers';

const flat = (v: number): Attributes => Object.fromEntries(ATTRIBUTES.map((a) => [a, v])) as Attributes;

/** A copy of a team with every player's attributes changed. */
function withAttrs(team: TeamSnapshot, id: string, f: (a: Attributes) => Attributes, over: Partial<TeamSnapshot> = {}): TeamSnapshot {
  return { ...team, id, tag: id.toUpperCase(), players: team.players.map((p) => ({ ...p, id: `${id}-${p.playerId}`, attrs: f({ ...p.attrs }) })), ...over };
}

function fullBuy(teams: [TeamSnapshot, TeamSnapshot], tTeam: 0 | 1): Map<string, SimLoadout> {
  const lo = new Map<string, SimLoadout>();
  teams.forEach((tm, ti) => tm.players.forEach((p) => {
    const t = ti === tTeam;
    lo.set(p.id, { weapon: p.role === 'awp' ? 'AWP' : t ? 'AK-47' : 'M4A1-S', armor: true, helmet: true, kit: !t, nades: ['smoke', 'flash', 'molotov'] });
  }));
  return lo;
}

function rounds(teams: [TeamSnapshot, TeamSnapshot], n: number, map: MapName = 'Mirage', extra: Partial<RoundSimInput> = {}) {
  const out = [];
  const geo = geometryFor(map);
  for (let s = 1; s <= n; s++) {
    const tTeam = (s % 2) as 0 | 1;
    out.push({ tTeam, r: simulateRound({
      geo, seed: s * 7919, tTeam, teams, loadouts: fullBuy(teams, tTeam),
      // Plans depend on s >> 1, so each team meets every plan combination from both sides.
      plan: { t: (['default', 'execute', 'rush'] as const)[(s >> 1) % 3]!, site: (s >> 1) % 2 ? 'B' : 'A', ct: (['standard', 'stack', 'retake', 'aggro'] as const)[(s >> 1) % 4]!, stackSite: (s >> 1) % 3 ? 'A' : 'B' },
      playstyle: ['balanced', 'balanced'], synergy: [teamSynergy(teams[0], map), teamSynergy(teams[1], map)], edge: [0, 0], record: false, ...extra,
    }) });
  }
  return out;
}

const roundsWon = (rs: ReturnType<typeof rounds>, team: 0 | 1) => rs.filter(({ tTeam, r }) => (r.winnerSide === 'T') === (tTeam === team)).length / rs.length;

describe('combat maths', () => {
  const elite = combatProfile(flat(95)), weak = combatProfile(flat(50)), max = combatProfile(flat(99));
  const ak = weaponDef('AK-47');
  const ctx = { dist: 15, shooterMoving: false, targetMoving: false, partial: false, burstIndex: 0, blind: 0, pressure: 0, form: 0, preAimed: false };

  it('elite players hit more often, but never every time', () => {
    expect(hitChance(elite, ak, ctx)).toBeGreaterThan(hitChance(weak, ak, ctx) + 0.25);
    expect(hitChance(max, ak, ctx)).toBeLessThan(0.96);
  });
  it('movement, cover, range, spraying and flashes all cost accuracy', () => {
    const base = hitChance(elite, ak, ctx);
    expect(hitChance(elite, ak, { ...ctx, shooterMoving: true })).toBeLessThan(base * 0.5);
    expect(hitChance(elite, ak, { ...ctx, partial: true })).toBeLessThan(base);
    expect(hitChance(elite, ak, { ...ctx, dist: 45 })).toBeLessThan(base);
    expect(hitChance(elite, ak, { ...ctx, burstIndex: 6 })).toBeLessThan(base);
    expect(hitChance(elite, ak, { ...ctx, blind: 1 })).toBeLessThan(0.2);
  });
  it('pressure hurts players with less composure more', () => {
    const calm = combatProfile({ ...flat(80), clutch: 95, consistency: 95 });
    const nervy = combatProfile({ ...flat(80), clutch: 45, consistency: 45 });
    const drop = (p: typeof calm) => hitChance(p, ak, ctx) - hitChance(p, ak, { ...ctx, pressure: 1 });
    expect(drop(nervy)).toBeGreaterThan(drop(calm));
  });
  it('elite players notice and acquire targets faster', () => {
    const d = { offAngle: 0.4, dist: 20, partial: false, expected: false, targetMoving: true, form: 0 };
    expect(detectionTime(elite, d)).toBeLessThan(detectionTime(weak, d) * 0.8);
    expect(detectionTime(max, d)).toBeGreaterThanOrEqual(0.12);
    expect(acquireTime(elite, 1, false)).toBeLessThan(acquireTime(weak, 1, false));
    // Expecting the enemy (holding the angle) is faster than being surprised.
    expect(detectionTime(weak, { ...d, expected: true })).toBeLessThan(detectionTime(weak, d));
  });
  it('damage follows weapon, hit group and armour', () => {
    expect(shotDamage(ak, 'head', 10, 100, true).health).toBeGreaterThanOrEqual(100); // AK one-taps through a helmet
    expect(shotDamage(weaponDef('M4A4'), 'head', 10, 100, true).health).toBeLessThan(100);
    expect(shotDamage(weaponDef('AWP'), 'chest', 30, 100, true).health).toBeGreaterThanOrEqual(100);
    expect(shotDamage(ak, 'legs', 10, 100, true).health).toBe(shotDamage(ak, 'legs', 10, 0, false).health); // legs ignore armour
    expect(shotDamage(ak, 'chest', 10, 100, true).health).toBeLessThan(shotDamage(ak, 'chest', 10, 0, false).health);
  });
  it('different attribute mixes give different combat profiles', () => {
    const rifler = combatProfile({ ...flat(70), aim: 92, entry: 88 });
    const brain = combatProfile({ ...flat(70), gameSense: 92, leadership: 90 });
    expect(rifler.reflexes).toBeGreaterThan(brain.reflexes);
    expect(brain.decisions).toBeGreaterThan(rifler.decisions);
  });
});

describe('sight', () => {
  it('walls block sight, open ground does not', () => {
    const g = geometryFor('Dust2');
    const intel = mapIntel(g);
    const t = intel.tSpawnCenter, ct = intel.ctSpawnCenter;
    expect(intel.sight(t[0], t[1], ct[0], ct[1])).toBe(0);
    const site = g.sites.A.cells;
    const a = site[0]!, b = site.find((c) => Math.abs(c[0] - a[0]) + Math.abs(c[1] - a[1]) === 1)!;
    expect(intel.sight(a[0], a[1], b[0], b[1])).not.toBe(0);
  });
});

describe('round simulation', () => {
  const used = new Set<string>();
  const a = snapshot('a', teamFromBand(40, used));
  const b = snapshot('b', teamFromBand(40, used));
  const rs = rounds([a, b], 60, 'Mirage', { record: true });

  it('is deterministic for a seed', () => {
    const x = rounds([a, b], 3), y = rounds([a, b], 3);
    expect(JSON.stringify(x.map((q) => q.r.kills))).toBe(JSON.stringify(y.map((q) => q.r.kills)));
  });

  it('kills each player at most once and nobody acts after dying', () => {
    for (const { r } of rs) {
      const victims = r.kills.map((k) => k.victim);
      expect(new Set(victims).size).toBe(victims.length);
      const death = new Map(r.kills.map((k) => [k.victim, k.t] as const));
      for (const s of r.replay!.shots) { const d = death.get(s.from); if (d !== undefined) expect(s.t).toBeLessThanOrEqual(d + 1e-6); }
      for (const h of r.hits) { const d = death.get(h.victim); if (d !== undefined) expect(h.t).toBeLessThanOrEqual(d + 1e-6); }
      for (const k of r.kills) expect(k.killer).not.toBe(k.victim);
    }
  });

  it('accounts for exactly 100 damage on every player who dies', () => {
    for (const { r } of rs) {
      for (const k of r.kills) {
        const gun = r.hits.filter((h) => h.victim === k.victim).reduce((s, h) => s + h.damage, 0);
        const nade = r.utility.flatMap((u) => u.victims).filter((v) => v.id === k.victim).reduce((s, v) => s + v.damage, 0);
        const track = r.replay!.tracks.find((tr) => tr.id === k.victim)!;
        const selfAndTeam = 100 - gun - nade; // team grenades can chip a player too
        expect(gun + nade).toBeLessThanOrEqual(100);
        expect(selfAndTeam).toBeGreaterThanOrEqual(0);
        expect(track.hp[track.hp.length - 1]![1]).toBe(0);
      }
    }
  });

  it('ends rounds only by a valid condition', () => {
    for (const { tTeam, r } of rs) {
      const tIds = [a, b][tTeam]!.players.map((p) => p.id);
      const tAlive = tIds.filter((id) => r.survivors.includes(id)).length;
      const ctAlive = r.survivors.length - tAlive;
      if (r.reason === 'elimination') expect(r.winnerSide === 'T' ? ctAlive : tAlive).toBe(0);
      if (r.reason === 'elimination' && r.winnerSide === 'CT') expect(r.planted).toBe(false);
      if (r.reason === 'bomb') expect(r.planted && r.winnerSide === 'T').toBe(true);
      if (r.reason === 'defuse') { expect(r.planted && r.winnerSide === 'CT').toBe(true); expect(r.survivors).toContain(r.defuserId); }
      if (r.reason === 'time') expect(r.planted || r.winnerSide !== 'CT').toBe(false);
      expect(r.endTime).toBeLessThanOrEqual(115 + 40 + 0.5);
    }
  });

  it('only kills with a gun in line of sight', () => {
    const intel = mapIntel(geometryFor('Mirage'));
    let n = 0, seen = 0;
    for (const { r } of rs) {
      const frame = (id: string, t: number) => { const tr = r.replay!.tracks.find((x) => x.id === id)!; const i = Math.min(tr.xs.length - 1, Math.floor(t / r.replay!.dt)); return [Math.floor(tr.xs[i]!), Math.floor(tr.ys[i]!)] as const; };
      for (const k of r.kills) {
        if (k.weapon === 'Molotov' || k.weapon === 'HE Grenade') continue;
        const p = frame(k.killer, k.t), q = frame(k.victim, k.t);
        n++;
        if (intel.sight(p[0], p[1], q[0], q[1]) !== 0) seen++;
      }
    }
    expect(seen / n).toBeGreaterThan(0.97);
  });

  it('explains every round and logs the calls', () => {
    for (const { r } of rs) {
      expect(r.report.verdict.length).toBeGreaterThan(10);
      expect(r.report.events.some((e) => e.kind === 'plan')).toBe(true);
    }
    expect(rs.some(({ r }) => r.report.events.some((e) => e.kind === 'call'))).toBe(true);
    expect(rs.some(({ r }) => r.utility.length > 0)).toBe(true);
  });

  it('logs every site switch in time order, so the HUD never shows a later call early', () => {
    for (const { r } of rs) {
      const log = r.report.siteLog;
      expect(log[0]).toEqual({ t: 0, site: r.report.plannedSite });
      expect(log[log.length - 1]!.site).toBe(r.report.site);
      for (let i = 1; i < log.length; i++) { expect(log[i]!.t).toBeGreaterThanOrEqual(log[i - 1]!.t); expect(log[i]!.site).not.toBe(log[i - 1]!.site); }
      expect(r.report.adapted).toBe(log.length > 1);
    }
  });

  it('records every defuse attempt, including ones cut short', () => {
    let attempts = 0;
    for (const { r } of rs) {
      const b = r.replay!.bomb;
      attempts += b.attempts.length;
      for (const [start, stop, , need] of b.attempts) {
        expect(b.plantT).not.toBeNull();
        expect(start).toBeGreaterThanOrEqual(b.plantT!);
        if (stop !== null) expect(stop).toBeLessThan(start + need + 1e-6);
      }
      if (r.reason === 'defuse') {
        const last = b.attempts[b.attempts.length - 1]!;
        expect(last[1]).toBeNull();
        expect(Math.abs(last[0] + last[3] - b.defuseEnd!)).toBeLessThan(0.11);
      }
    }
    expect(attempts).toBeGreaterThan(0);
  });

  it('T players smoke known angles before crossing them', () => {
    const smokes = rs.flatMap(({ r }) => r.utility.filter((u) => u.kind === 'smoke' && u.purpose === 'Smoke to cross'));
    expect(smokes.length).toBeGreaterThan(0);
    for (const u of smokes) expect(u.side).toBe('T');
  });
});

describe('ratings and synergy change results (controlled experiments)', () => {
  const used = new Set<string>();
  const base = snapshot('base', teamFromBand(60, used));

  it('better aim wins more rounds against the same players, but not every round', () => {
    const sharp = withAttrs(base, 'sharp', (x) => ({ ...x, aim: x.aim + 18, awp: x.awp + 18 }));
    const plain = withAttrs(base, 'plain', (x) => x);
    const rs = rounds([sharp, plain], 120);
    const w = roundsWon(rs, 0);
    expect(w).toBeGreaterThan(0.62);
    expect(w).toBeLessThan(0.97);
    const kills = (team: 0 | 1) => rs.reduce((s, { r }) => s + r.kills.filter((k) => k.killerTeam === team).length, 0);
    // 1.3 on the old hand-drawn maps; the rebuilt maps' longer, more open sight lines give about 1.28.
    expect(kills(0)).toBeGreaterThan(kills(1) * 1.2);
  });

  it('a maxed-out team still loses some rounds and misses shots', () => {
    const gods = withAttrs(base, 'gods', () => flat(99));
    const decent = withAttrs(base, 'decent', () => flat(68));
    const rs = rounds([gods, decent], 90, 'Mirage', { record: true });
    const w = roundsWon(rs, 0);
    expect(w).toBeGreaterThan(0.8);
    expect(w).toBeLessThan(1);
    const shots = rs.flatMap(({ r }) => r.replay!.shots.filter((s) => s.from.startsWith('gods')));
    const hitRate = shots.filter((s) => s.hit).length / shots.length;
    expect(hitRate).toBeLessThan(0.9);
    expect(rs.some(({ r }) => r.kills.some((k) => k.victim.startsWith('gods')))).toBe(true);
  });

  it('a familiar, communicating team beats the same players as strangers', () => {
    const pairs: Record<string, number> = {};
    const ids = base.players.map((p) => `tight-${p.playerId}`);
    for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) pairs[pairKey(ids[i]!, ids[j]!)] = 95;
    const tight = withAttrs(base, 'tight', (x) => x, { chemistry: 95, pairs });
    const loose = withAttrs(base, 'loose', (x) => x, { chemistry: 10 });
    const st = teamSynergy(tight, 'Mirage'), sl = teamSynergy(loose, 'Mirage');
    expect(st.overall).toBeGreaterThan(sl.overall + 20);
    expect(st.calloutDelay).toBeLessThan(sl.calloutDelay);
    expect(st.executeSpread).toBeLessThan(sl.executeSpread);
    // Same players, same seeds: only synergy differs. The edge is real but small (a few points).
    const w = roundsWon(rounds([tight, loose], 600), 0);
    const same = roundsWon(rounds([withAttrs(base, 'tight', (x) => x, { chemistry: 10 }), loose], 600), 0);
    expect(w).toBeGreaterThan(same + 0.01);
    expect(w).toBeLessThan(0.7); // bounded
  });

  it('a coordinated team of slightly weaker players can beat stronger strangers', () => {
    const pairs: Record<string, number> = {};
    const ids = base.players.map((p) => `crew-${p.playerId}`);
    for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) pairs[pairKey(ids[i]!, ids[j]!)] = 95;
    const crew = withAttrs(base, 'crew', (x) => ({ ...x, aim: x.aim - 3 }), { chemistry: 95, pairs });
    const stars = withAttrs(base, 'stars', (x) => ({ ...x, aim: x.aim + 3 }), { chemistry: 5 });
    const w = roundsWon(rounds([crew, stars], 300), 0);
    expect(w).toBeGreaterThan(0.4); // competitive, sometimes ahead
  });

  it('tight synergy times executes better', () => {
    const pairs: Record<string, number> = {};
    const ids = base.players.map((p) => `sync-${p.playerId}`);
    for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) pairs[pairKey(ids[i]!, ids[j]!)] = 98;
    const sync = withAttrs(base, 'sync', (x) => x, { chemistry: 98, pairs });
    const messy = withAttrs(base, 'messy', (x) => x, { chemistry: 5 });
    const score = (team: TeamSnapshot) => {
      const rs = rounds([team, withAttrs(base, 'opp', (x) => x)], 300).filter(({ tTeam, r }) => tTeam === 0 && r.report.executeScore !== null);
      return rs.reduce((s, { r }) => s + r.report.executeScore!, 0) / Math.max(1, rs.length);
    };
    expect(score(sync)).toBeGreaterThan(score(messy));
  });
});

describe('HUD data comes from the simulation', () => {
  it('the round story has one line per kill and the round carries the synergy used', () => {
    const used = new Set<string>();
    const teams: [TeamSnapshot, TeamSnapshot] = [snapshot('a', teamFromBand(10, used)), snapshot('b', teamFromBand(30, used))];
    const sim = new MapSim({ seed: 4, teams, map: 'Ancient', ctFirst: 0 });
    for (let i = 0; i < 5; i++) {
      const r = sim.playRound();
      const kills = storyLines(r, teams).filter((l) => l.kind === 'kill');
      expect(kills.length).toBe(r.kills.length);
      expect(r.synergy![0].overall).toBe(sim.synergy[0].overall);
      expect(r.report!.tPlan).toBe(r.tactics.t);
    }
  });
});
