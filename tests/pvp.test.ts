import { describe, expect, it } from 'vitest';
import { MapSim, simulateSeries } from '../src/engine/match';
import type { TeamIdx } from '../src/engine/match';
import { Rng } from '../src/engine/rng';
import {
  canJoin, configKey, defaultConfig, fingerprint, headToHead, matchSeed, newRoom, newRoomCode, normalizeCode, pvpTeam,
  resultHash, runPvpSeries, settle, sideOf, startCheck, summarize, validateConfig, validatePvpTeam,
} from '../src/engine/pvp';
import type { PvpEntry, PvpRoom } from '../src/engine/pvp';
import { snapshot, teamFromBand } from './helpers';

const used = new Set<string>();
const A = snapshot('a', teamFromBand(10, used), undefined, { prepBonus: 3 });
const B = snapshot('b', teamFromBand(40, used));

function entry(side: TeamIdx, userId: string, ready = true, room?: PvpRoom): PvpEntry {
  const team = pvpTeam(side === 0 ? A : B, side);
  return { userId, manager: userId, team, teamHash: fingerprint(team), ready, ...(ready && room ? { readyFor: configKey(room.config) } : {}) };
}

function readyRoom(): PvpRoom {
  return { ...newRoom('K7QM2P', 'host-user', 'Alpha', 'ALP', { format: 'bo1', maps: ['Mirage'] }, 1), guestId: 'guest-user', names: ['Alpha', 'Beta'], tags: ['ALP', 'BET'], state: 'ready' };
}

describe('room codes', () => {
  it('are six characters without look-alikes and normalize from sloppy input', () => {
    const rng = new Rng(5);
    for (let i = 0; i < 200; i++) {
      const c = newRoomCode(() => rng.next());
      expect(c).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
      expect(normalizeCode(c.toLowerCase())).toBe(c);
    }
    expect(normalizeCode(' k7q-m2p ')).toBe('K7QM2P');
    expect(normalizeCode('ABC')).toBeNull();
    expect(normalizeCode('K7QM2P!')).toBeNull();
  });
});

describe('teams', () => {
  it('a PvP team keeps the roster and switches off opponent preparation', () => {
    const t = pvpTeam(A, 0);
    expect(t.prepBonus).toBe(0);
    expect(t.players.map((p) => p.handle)).toEqual(A.players.map((p) => p.handle));
    expect(new Set([...t.players, ...pvpTeam(A, 1).players].map((p) => p.id)).size).toBe(10);
    expect(validatePvpTeam(t).ok).toBe(true);
  });
  it('rejects tampered or incomplete rosters', () => {
    const t = pvpTeam(A, 0);
    expect(validatePvpTeam({ ...t, players: t.players.slice(0, 4) }).ok).toBe(false);
    expect(validatePvpTeam({ ...t, players: [...t.players.slice(0, 4), t.players[0]!] }).errors.join(' ')).toMatch(/twice/);
    expect(validatePvpTeam({ ...t, players: t.players.map((p, i) => (i ? p : { ...p, attrs: { ...p.attrs, aim: 140 } })) }).ok).toBe(false);
    expect(validatePvpTeam({ ...t, prepBonus: 5 }).ok).toBe(false);
    expect(validatePvpTeam(null).ok).toBe(false);
  });
  it('fingerprints ignore key order and catch any change', () => {
    expect(fingerprint({ a: 1, b: [1, 2] })).toBe(fingerprint({ b: [1, 2], a: 1 }));
    const t = pvpTeam(A, 0);
    expect(fingerprint({ ...t, chemistry: t.chemistry + 1 })).not.toBe(fingerprint(t));
  });
});

describe('settings and rooms', () => {
  it('validates formats and map picks', () => {
    expect(validateConfig(defaultConfig()).ok).toBe(true);
    expect(validateConfig({ format: 'bo3', maps: ['Mirage', 'Inferno', 'Nuke'] }).ok).toBe(true);
    expect(validateConfig({ format: 'bo3', maps: ['Mirage', 'Mirage', 'Nuke'] }).ok).toBe(false);
    expect(validateConfig({ format: 'bo1', maps: [] }).ok).toBe(false);
  });
  it('join rules: no self-join, no third player, no joining after the start', () => {
    const r = newRoom('K7QM2P', 'h', 'Alpha', 'ALP', defaultConfig(), 1);
    expect(canJoin(null, 'g').ok).toBe(false);
    expect(canJoin(r, 'h').ok).toBe(false);
    expect(canJoin(r, 'g').ok).toBe(true);
    const full = { ...r, guestId: 'g', state: 'ready' as const };
    expect(canJoin(full, 'g').ok).toBe(true); // rejoining your own seat after a reload
    expect(canJoin(full, 'x').ok).toBe(false);
    expect(canJoin({ ...r, state: 'abandoned' }, 'x').ok).toBe(false);
    expect(sideOf(full, 'h')).toBe(0); expect(sideOf(full, 'g')).toBe(1); expect(sideOf(full, 'x')).toBeNull();
  });
  it('start needs both teams valid, unchanged and ready for the current settings', () => {
    const room = readyRoom();
    expect(startCheck(room, entry(0, 'host-user', true, room), entry(1, 'guest-user', true, room)).ok).toBe(true);
    expect(startCheck(room, entry(0, 'host-user', true, room), entry(1, 'guest-user', false)).ok).toBe(false);
    expect(startCheck(room, entry(0, 'host-user', true, room), null).ok).toBe(false);
    const changed = { ...room, config: { format: 'bo1' as const, maps: ['Nuke' as const] } };
    expect(startCheck(changed, entry(0, 'host-user', true, room), entry(1, 'guest-user', true, room)).errors.join(' ')).toMatch(/current settings/);
    const g = entry(1, 'guest-user', true, room);
    expect(startCheck(room, entry(0, 'host-user', true, room), { ...g, team: { ...g.team, chemistry: 99 } }).errors.join(' ')).toMatch(/changed after/);
    expect(startCheck({ ...room, state: 'in_progress' }, entry(0, 'host-user', true, room), g).ok).toBe(false);
  });
});

describe('results', () => {
  it('the same room gives the same series on any machine, and both sides agree', () => {
    const room = readyRoom();
    const h = entry(0, 'host-user', true, room), g = entry(1, 'guest-user', true, room);
    const started: PvpRoom = { ...room, state: 'in_progress', seed: matchSeed(room.code, h.teamHash, g.teamHash) };
    // A JSON round trip stands in for the shared database between the two browsers.
    const hJ = JSON.parse(JSON.stringify(h)) as PvpEntry, gJ = JSON.parse(JSON.stringify(g)) as PvpEntry;
    const s1 = runPvpSeries(started, h, g), s2 = runPvpSeries(JSON.parse(JSON.stringify(started)) as PvpRoom, hJ, gJ);
    expect(resultHash(s1)).toBe(resultHash(s2));
    expect(settle(started, { ...h, resultHash: resultHash(s1) }, { ...g, resultHash: resultHash(s2) })).toBe('completed');
    expect(settle(started, { ...h, resultHash: resultHash(s1) }, { ...g, resultHash: 'tampered' })).toBe('disputed');
    expect(settle(started, { ...h, resultHash: resultHash(s1) }, g)).toBeNull();
    const sum = summarize(s1, [h.team, g.team]);
    expect(sum.players).toHaveLength(10);
    expect(sum.mapScore[sum.winner]).toBeGreaterThan(sum.mapScore[sum.winner === 0 ? 1 : 0]);
    expect(headToHead([{ ...started, state: 'completed', summary: sum }], 'host-user')).toEqual(sum.winner === 0 ? { wins: 1, losses: 0 } : { wins: 0, losses: 1 });
  });
  it('the match screen (recorded, round by round) plays out the same series as the result', () => {
    const room = readyRoom();
    const h = entry(0, 'host-user', true, room), g = entry(1, 'guest-user', true, room);
    const seed = matchSeed(room.code, h.teamHash, g.teamHash);
    const series = simulateSeries(seed, [h.team, g.team], ['Mirage'], 'bo1');
    // Live builds its plan the same way and records replays; recording must not change the outcome.
    const rng = new Rng(seed);
    const sim = new MapSim({ seed: rng.int(1, 2 ** 31 - 1), teams: [h.team, g.team], map: 'Mirage', ctFirst: rng.chance(0.5) ? 0 : 1, record: true });
    while (!sim.finished) sim.playRound();
    expect(sim.result().score).toEqual(series.maps[0]!.score);
  });
});
