/** The beta ladder's server calls (tables and rules in supabase/beta.sql). */
import type { PvpSummary } from '../engine/pvp';
import type { TeamSnapshot } from '../engine/team';
import { supa } from './supa';

export interface LadderPlayer {
  id: string;
  userId: string | null;
  botSlot: number | null;
  manager: string;
  team: string;
  tag: string;
  rating: number;
  wins: number;
  losses: number;
  hasTeam: boolean;
}

export interface LadderMatch {
  id: number;
  challenger: string;
  defender: string;
  status: 'pending' | 'won' | 'lost';
  delta: number;
  summary: PvpSummary | null;
  createdAt: number;
}

export interface Challenge { id: number; seed: number; defenderTeam: TeamSnapshot | null; botSlot: number | null }

const plain = (m: string) => (/fetch|network/i.test(m) ? 'Can’t reach the game server. Check your connection.' : m);

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const sb = await supa();
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(plain(error.message));
  return data as T;
}

export const myLadderId = (userId: string) => `u-${userId}`;

export async function ladderPlayers(): Promise<LadderPlayer[]> {
  const sb = await supa();
  const { data, error } = await sb.from('ladder_players')
    .select('id, user_id, bot_slot, manager, team, tag, rating, wins, losses, has_team:snapshot->>name')
    .order('rating', { ascending: false }).order('wins', { ascending: false }).limit(200);
  if (error) throw new Error(plain(error.message));
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string, userId: (r.user_id as string | null) ?? null, botSlot: (r.bot_slot as number | null) ?? null,
    manager: r.manager as string, team: r.team as string, tag: r.tag as string,
    rating: r.rating as number, wins: r.wins as number, losses: r.losses as number, hasTeam: r.has_team != null,
  }));
}

export async function recentMatches(ladderId: string, limit = 12): Promise<LadderMatch[]> {
  const sb = await supa();
  const { data, error } = await sb.from('ladder_matches')
    .select('id, challenger, defender, status, delta, summary, created_at')
    .or(`challenger.eq.${ladderId},defender.eq.${ladderId}`)
    .order('id', { ascending: false }).limit(limit);
  if (error) throw new Error(plain(error.message));
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as number, challenger: r.challenger as string, defender: r.defender as string, status: r.status as LadderMatch['status'],
    delta: r.delta as number, summary: (r.summary as PvpSummary | null) ?? null, createdAt: Date.parse(r.created_at as string),
  }));
}

export function joinLadder(manager: string, team: string, tag: string, snapshot: TeamSnapshot): Promise<string> {
  return rpc<string>('ladder_join', { manager, team, tag, snapshot });
}

export async function startChallenge(opponent: string): Promise<Challenge> {
  const d = await rpc<Record<string, unknown>>('ladder_challenge', { opponent });
  return { id: d.id as number, seed: d.seed as number, defenderTeam: (d.defender_team as TeamSnapshot | null) ?? null, botSlot: (d.bot_slot as number | null) ?? null };
}

/** Returns the rating change that stands. */
export function reportChallenge(id: number, won: boolean, summary: PvpSummary, hash: string, defenderTeam: TeamSnapshot | null): Promise<number> {
  return rpc<number>('ladder_report', { match_id: id, won, summary, result_hash: hash, defender_team: defenderTeam });
}
