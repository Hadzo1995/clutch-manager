/**
 * PvP challenges: two managers put their own career teams against each other.
 *
 * The rules live here, apart from any network code, so both players' browsers
 * (and the tests) apply exactly the same ones:
 *  - Each side submits a frozen snapshot of the team as built in their career
 *    (lineup, roles, coach, training, form, chemistry, map practice). The only
 *    change is that opponent-specific preparation is switched off for both,
 *    because neither side scouted the other through a fixture.
 *  - The match seed comes from the room code and both team fingerprints, so it
 *    is fixed the moment both teams are locked, and anyone holding the room can
 *    re-run the series and get the same result.
 *  - Each browser simulates the series itself and publishes a fingerprint of the
 *    result. The room is completed only when both fingerprints agree; if they
 *    differ the room is marked disputed instead of trusting either side.
 */
import { simulateSeries } from './match';
import type { SeriesFormat, SeriesResult, TeamIdx } from './match';
import { seriesLines } from './report';
import { hashString } from './rng';
import { teamStrength } from './team';
import type { TeamSnapshot } from './team';
import { ATTRIBUTES, MAPS, ROLES } from './types';
import type { MapName } from './types';

export const PVP_VERSION = 1;

export type PvpState = 'waiting' | 'ready' | 'in_progress' | 'completed' | 'abandoned' | 'disputed';
export const PVP_STATE_LABEL: Record<PvpState, string> = {
  waiting: 'Waiting for opponent',
  ready: 'Lobby: confirm your teams',
  in_progress: 'Match in progress',
  completed: 'Completed',
  abandoned: 'Abandoned',
  disputed: 'Results disagree',
};

export interface PvpConfig {
  format: SeriesFormat;
  /** Maps in play order: one for Bo1, three for Bo3 (the third is the decider). */
  maps: MapName[];
}

/** One side's locked team, as stored in the room. */
export interface PvpEntry {
  userId: string;
  manager: string;
  team: TeamSnapshot;
  teamHash: string;
  ready: boolean;
  /** The settings (configKey) this side said ready to; changing the settings un-readies both. */
  readyFor?: string;
  /** Display only: each player's card OVR (by PvP player id). Not used by the simulation. */
  ovr?: Record<string, number>;
  /** Result fingerprint this side computed once the match started. */
  resultHash?: string;
}

export interface PvpMapLine { map: MapName; score: [number, number]; winner: TeamIdx }
export interface PvpPlayerLine { id: string; handle: string; team: TeamIdx; kills: number; deaths: number; adr: number; rating: number }
export interface PvpSummary {
  mapScore: [number, number];
  winner: TeamIdx;
  maps: PvpMapLine[];
  players: PvpPlayerLine[];
}

export interface PvpRoom {
  v: number;
  code: string;
  createdAt: number;
  hostId: string;
  guestId: string | null;
  names: [string, string];
  tags: [string, string];
  state: PvpState;
  config: PvpConfig;
  seed: number | null;
  startedAt: number | null;
  endedAt: number | null;
  summary: PvpSummary | null;
  resultHash: string | null;
  /** Room this one is a rematch of, and the rematch offered from this one. */
  rematchOf: string | null;
  rematchCode: string | null;
  abandonedBy: string | null;
}

// ---------------------------------------------------------------- codes

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
export const CODE_LENGTH = 6;

export function newRoomCode(random: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)]!;
  return s;
}

/** Upper-cases and strips spaces and dashes; returns null when it can't be a room code. */
export function normalizeCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/I/g, '1');
  const back = s.replace(/0/g, 'O').replace(/1/g, 'I');
  if (back.length !== CODE_LENGTH) return null;
  for (const ch of back) if (!CODE_ALPHABET.includes(ch)) return null;
  return back;
}

// ---------------------------------------------------------------- teams

/** Order-independent, stable JSON (keys sorted) for fingerprints. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
}

export function fingerprint(v: unknown): string {
  const s = stableStringify(v);
  return (hashString(s).toString(36) + hashString(s.split('').reverse().join('')).toString(36)).padStart(12, '0');
}

/**
 * The team a side brings to PvP: its career snapshot, renamed so the two
 * sides' ids can never collide, with opponent preparation removed.
 */
export function pvpTeam(snap: TeamSnapshot, side: TeamIdx): TeamSnapshot {
  const prefix = side === 0 ? 'h-' : 'g-';
  const idMap = new Map(snap.players.map((p) => [p.id, prefix + p.id]));
  const pairs: Record<string, number> = {};
  for (const [k, v] of Object.entries(snap.pairs ?? {})) {
    const [a, b] = k.split('|');
    const na = idMap.get(a ?? ''), nb = idMap.get(b ?? '');
    if (na && nb) pairs[na < nb ? `${na}|${nb}` : `${nb}|${na}`] = v;
  }
  return {
    ...snap,
    id: side === 0 ? 'pvp-host' : 'pvp-guest',
    isHuman: true,
    prepBonus: 0,
    players: snap.players.map((p) => ({ ...p, id: idMap.get(p.id)! })),
    pairs,
  };
}

export interface TeamCheck { ok: boolean; errors: string[] }

/** Checks a submitted team is a legal, untampered-looking lineup before anyone plays it. */
export function validatePvpTeam(t: TeamSnapshot | null | undefined): TeamCheck {
  const errors: string[] = [];
  if (!t || typeof t !== 'object') return { ok: false, errors: ['No team submitted.'] };
  if (!Array.isArray(t.players) || t.players.length !== 5) errors.push('A team needs exactly five players.');
  const ids = new Set<string>();
  for (const p of t.players ?? []) {
    if (ids.has(p.id)) errors.push(`Player ${p.handle} appears twice.`);
    ids.add(p.id);
    if (!(ROLES as readonly string[]).includes(p.role)) errors.push(`${p.handle} has an unknown role.`);
    for (const a of ATTRIBUTES) {
      const v = (p.attrs as Record<string, number>)[a];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) errors.push(`${p.handle}: ${a} must be 0-100.`);
    }
    for (const m of MAPS) {
      const v = p.mapSkill?.[m];
      if (typeof v !== 'number' || v < 0 || v > 100) errors.push(`${p.handle}: map skill for ${m} must be 0-100.`);
    }
    if (typeof p.roleFit !== 'number' || p.roleFit < 0.8 || p.roleFit > 1) errors.push(`${p.handle}: role fit out of range.`);
  }
  if (typeof t.chemistry !== 'number' || t.chemistry < 0 || t.chemistry > 100) errors.push('Chemistry must be 0-100.');
  for (const m of MAPS) {
    const v = t.mapPractice?.[m];
    if (typeof v !== 'number' || v < 0 || v > 100) errors.push(`Map practice for ${m} must be 0-100.`);
  }
  if (t.prepBonus !== 0) errors.push('Opponent preparation is not allowed in PvP.');
  if (!t.tactics) errors.push('Tactics are missing.');
  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}

// ---------------------------------------------------------------- config

export function validateConfig(c: PvpConfig): TeamCheck {
  const errors: string[] = [];
  if (c.format !== 'bo1' && c.format !== 'bo3') errors.push('Format must be Bo1 or Bo3.');
  const need = c.format === 'bo1' ? 1 : 3;
  if (!Array.isArray(c.maps) || c.maps.length !== need) errors.push(`Pick ${need} map${need > 1 ? 's' : ''}.`);
  if (new Set(c.maps).size !== c.maps.length) errors.push('Each map can only be played once.');
  for (const m of c.maps ?? []) if (!(MAPS as readonly string[]).includes(m)) errors.push(`Unknown map ${m}.`);
  return { ok: errors.length === 0, errors };
}

/** Fingerprint of the match settings, so a ready flag only counts for the settings it was given for. */
export function configKey(c: PvpConfig): string {
  return fingerprint({ f: c.format, m: c.maps });
}

export function defaultConfig(): PvpConfig {
  return { format: 'bo1', maps: ['Mirage'] };
}

// ---------------------------------------------------------------- rooms

export function newRoom(code: string, hostId: string, hostName: string, hostTag: string, config: PvpConfig, now: number): PvpRoom {
  return {
    v: PVP_VERSION, code, createdAt: now, hostId, guestId: null, names: [hostName, ''], tags: [hostTag, ''],
    state: 'waiting', config, seed: null, startedAt: null, endedAt: null, summary: null, resultHash: null,
    rematchOf: null, rematchCode: null, abandonedBy: null,
  };
}

/** Which side a user plays in a room, or null for a spectator. */
export function sideOf(room: PvpRoom, userId: string | null): TeamIdx | null {
  if (!userId) return null;
  if (room.hostId === userId) return 0;
  if (room.guestId === userId) return 1;
  return null;
}

export type JoinCheck = { ok: true } | { ok: false; reason: string };

export function canJoin(room: PvpRoom | null, userId: string): JoinCheck {
  if (!room) return { ok: false, reason: 'No room with that code.' };
  if (room.hostId === userId) return { ok: false, reason: 'This is your own room. Share the code with your opponent.' };
  if (room.guestId === userId) return { ok: true };
  if (room.guestId) return { ok: false, reason: 'This room already has two teams.' };
  if (room.state !== 'waiting') return { ok: false, reason: `This room is ${PVP_STATE_LABEL[room.state].toLowerCase()}.` };
  return { ok: true };
}

/** The seed is fixed by the code and both locked teams. */
export function matchSeed(code: string, hostHash: string, guestHash: string): number {
  return (hashString(`${code}:${hostHash}:${guestHash}`) % 2147483646) + 1;
}

/** Whether the host may start: both sides submitted valid teams and are ready. */
export function startCheck(room: PvpRoom, host: PvpEntry | null, guest: PvpEntry | null): TeamCheck {
  const errors: string[] = [];
  if (room.state !== 'ready') errors.push(room.state === 'waiting' ? 'Waiting for an opponent to join.' : `Room is ${PVP_STATE_LABEL[room.state].toLowerCase()}.`);
  const cfg = validateConfig(room.config);
  errors.push(...cfg.errors);
  for (const [label, e] of [['Your opponent', guest], ['You', host]] as const) {
    if (!e) { errors.push(`${label} has not submitted a team.`); continue; }
    const t = validatePvpTeam(e.team);
    if (!t.ok) errors.push(...t.errors.map((x) => `${e.team?.name ?? label}: ${x}`));
    if (e.teamHash !== fingerprint(e.team)) errors.push(`${label}: team changed after it was locked.`);
    if (!e.ready || e.readyFor !== configKey(room.config)) errors.push(`${label === 'You' ? 'You are' : 'Your opponent is'} not ready${e.ready ? ' for the current settings' : ''}.`);
  }
  return { ok: errors.length === 0, errors };
}

/** Runs the series both browsers will show. Same inputs, same result, on any machine. */
export function runPvpSeries(room: PvpRoom, host: PvpEntry, guest: PvpEntry): SeriesResult {
  if (room.seed === null) throw new Error('Match has not started');
  return simulateSeries(room.seed, [host.team, guest.team], room.config.maps, room.config.format);
}

export function summarize(series: SeriesResult, teams: [TeamSnapshot, TeamSnapshot]): PvpSummary {
  const lines = seriesLines(series.maps);
  const teamOf = new Map<string, TeamIdx>();
  teams.forEach((t, i) => t.players.forEach((p) => teamOf.set(p.id, i as TeamIdx)));
  return {
    mapScore: series.mapScore,
    winner: series.winner,
    maps: series.maps.map((m) => ({ map: m.map, score: m.score, winner: m.winner })),
    players: lines.map((l) => ({ id: l.id, handle: l.handle, team: teamOf.get(l.id) ?? 0, kills: l.kills, deaths: l.deaths, adr: Math.round(l.damage / Math.max(1, l.rounds)), rating: Math.round(l.rating * 100) / 100 })),
  };
}

/** Fingerprint of everything that decides the result, round by round. */
export function resultHash(series: SeriesResult): string {
  return fingerprint({ s: series.mapScore, w: series.winner, m: series.maps.map((m) => ({ map: m.map, sc: m.score, r: m.rounds.map((r) => r.winner) })) });
}

/**
 * What the room becomes once results are in: completed when both sides'
 * fingerprints agree, disputed when they don't, unchanged while one is missing.
 */
export function settle(room: PvpRoom, host: PvpEntry | null, guest: PvpEntry | null): 'completed' | 'disputed' | null {
  if (room.state !== 'in_progress') return null;
  const a = host?.resultHash, b = guest?.resultHash;
  if (!a || !b) return null;
  return a === b ? 'completed' : 'disputed';
}

export function strengthOf(t: TeamSnapshot): number {
  return Math.round(teamStrength(t));
}

/** Head-to-head record between two users across completed rooms. */
export function headToHead(rooms: PvpRoom[], me: string): { wins: number; losses: number } {
  let wins = 0, losses = 0;
  for (const r of rooms) {
    if (r.state !== 'completed' || !r.summary) continue;
    const side = sideOf(r, me);
    if (side === null) continue;
    if (r.summary.winner === side) wins++; else losses++;
  }
  return { wins, losses };
}
