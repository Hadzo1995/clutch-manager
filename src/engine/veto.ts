/** Map veto. Bo1: alternate 6 bans, last map is played. Bo3: ban, ban, pick, pick, ban, ban, decider. */
import type { SeriesFormat, TeamIdx } from './match';
import { mapFamiliarity } from './team';
import type { TeamSnapshot } from './team';
import type { MapName } from './types';
import { MAPS } from './types';

export interface VetoStep { team: TeamIdx; action: 'ban' | 'pick' }

export function vetoSequence(format: SeriesFormat, first: TeamIdx): VetoStep[] {
  const second: TeamIdx = first === 0 ? 1 : 0;
  if (format === 'bo1') return [first, second, first, second, first, second].map((team) => ({ team, action: 'ban' as const }));
  return [
    { team: first, action: 'ban' }, { team: second, action: 'ban' },
    { team: first, action: 'pick' }, { team: second, action: 'pick' },
    { team: first, action: 'ban' }, { team: second, action: 'ban' },
  ];
}

export interface VetoState {
  format: SeriesFormat;
  steps: VetoStep[];
  done: { step: VetoStep; map: MapName }[];
  remaining: MapName[];
}

export function newVeto(format: SeriesFormat, first: TeamIdx): VetoState {
  return { format, steps: vetoSequence(format, first), done: [], remaining: [...MAPS] };
}

export function currentStep(v: VetoState): VetoStep | null {
  return v.steps[v.done.length] ?? null;
}

export function applyVeto(v: VetoState, map: MapName): VetoState {
  const step = currentStep(v);
  if (!step) throw new Error('Veto already complete');
  if (!v.remaining.includes(map)) throw new Error(`${map} is not available`);
  return { ...v, done: [...v.done, { step, map }], remaining: v.remaining.filter((m) => m !== map) };
}

/** Maps to play, in order, once the veto is complete. */
export function vetoMaps(v: VetoState): MapName[] {
  const picks = v.done.filter((d) => d.step.action === 'pick').map((d) => d.map);
  return [...picks, ...v.remaining.slice(0, 1)];
}

/** AI choice: ban the map where it is weakest relative to the opponent, pick where it is strongest. */
export function aiVetoChoice(v: VetoState, me: TeamSnapshot, opp: TeamSnapshot): MapName {
  const step = currentStep(v);
  const edge = (m: MapName) => mapFamiliarity(me, m) - mapFamiliarity(opp, m);
  const sorted = [...v.remaining].sort((a, b) => edge(a) - edge(b));
  return step?.action === 'pick' ? sorted[sorted.length - 1]! : sorted[0]!;
}

export function autoVeto(format: SeriesFormat, teams: [TeamSnapshot, TeamSnapshot], first: TeamIdx): MapName[] {
  let v = newVeto(format, first);
  while (currentStep(v)) {
    const s = currentStep(v)!;
    const me = teams[s.team];
    const opp = teams[s.team === 0 ? 1 : 0];
    v = applyVeto(v, aiVetoChoice(v, me, opp));
  }
  return vetoMaps(v);
}
